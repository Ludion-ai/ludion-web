using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Ludion.Wallpaper;

/// <summary>
/// アプリの本体。通知領域のアイコン（APP001「5」）、画面ごとの壁紙（「1」）、一覧（「2」）、
/// ludion:// の頼み（「3」）、止めるかどうかの見張り（「4」）、壁紙のオンとオフ、デスクトップのクリックを壁紙に渡すこと。
/// </summary>
internal sealed class App : ApplicationContext
{
    private readonly Settings settings = Settings.Load();
    private readonly SingleInstance instance;
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem onItem;
    private readonly ToolStripMenuItem pauseItem;
    private readonly ToolStripMenuItem soundItem;
    private readonly ToolStripMenuItem clicksItem;
    private readonly ToolStripMenuItem batteryItem;
    private readonly ToolStripMenuItem startupItem;
    private readonly System.Windows.Forms.Timer watch = new() { Interval = 1000 };
    private readonly List<WallpaperWindow> walls = [];
    private readonly Control ui = new();
    private CoreWebView2Environment? environment;
    private DesktopInput? input;
    private PickerWindow? picker;
    private bool locked;
    private string? previousId;
    private bool rebuilding;

    public App(SingleInstance instance, Command first)
    {
        this.instance = instance;
        ui.CreateControl();
        var text = Strings.Current;

        onItem = new ToolStripMenuItem(text.WallpaperOn, null, (_, _) => _ = SetWallpaperOnAsync(!settings.WallpaperOn));
        pauseItem = new ToolStripMenuItem(text.Pause, null, (_, _) => TogglePause());
        soundItem = new ToolStripMenuItem(text.Sound, null, (_, _) => ToggleSound());
        clicksItem = new ToolStripMenuItem(text.ForwardClicks, null, (_, _) => ToggleClicks());
        batteryItem = new ToolStripMenuItem(text.PauseOnBattery, null, (_, _) => ToggleBattery());
        startupItem = new ToolStripMenuItem(text.StartWithWindows, null, (_, _) => SetStartWithWindows(!IsStartWithWindows()));
        var menu = new ContextMenuStrip();
        menu.Items.AddRange([
            new ToolStripMenuItem(text.Change, null, (_, _) => ShowPicker()) { Font = new Font(menu.Font, FontStyle.Bold) },
            new ToolStripSeparator(),
            onItem,
            pauseItem,
            soundItem,
            clicksItem,
            new ToolStripSeparator(),
            batteryItem,
            startupItem,
            new ToolStripSeparator(),
            new ToolStripMenuItem(text.OpenSite, null, (_, _) => OpenSite()),
            new ToolStripMenuItem(text.Quit, null, (_, _) => Quit()),
        ]);
        menu.Opening += (_, _) => RefreshMenu();
        tray = new NotifyIcon { Icon = AppIcon.Tray, Text = text.TrayTitle, ContextMenuStrip = menu, Visible = true };
        // 左クリックで「壁紙を選ぶ」（オンとオフ、起動の切り替えもここ）
        tray.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) ShowPicker();
        };

        watch.Tick += (_, _) => _ = WatchAsync();
        SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        SystemEvents.SessionSwitch += OnSessionSwitch;
        SystemEvents.PowerModeChanged += OnPowerModeChanged;

        instance.Listen(SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext(), command => _ = HandleAsync(command));
        _ = StartAsync(first);
    }

    private async Task StartAsync(Command first)
    {
        try
        {
            Directory.CreateDirectory(Settings.Folder);
            var options = new CoreWebView2EnvironmentOptions
            {
                // 音は本人が入れたときだけ鳴る（初めは消してある）ので、押さなくても鳴らせるようにしておく。
                // 隠れたかどうかはアプリが見て止めるので、Chromium 自身の見張りは切る（アイコンの後ろで止まらないように）
                AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required --disable-features=CalculateNativeWinOcclusion",
            };
            environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Settings.Folder, "WebView2"), options);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(Strings.Current.NoWebView, "Ludion", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            Quit();
            return;
        }

        // デスクトップのクリックを壁紙に渡す（DesktopInput.cs）。動いている壁紙の画面の上だけ
        input = new DesktopInput(WallAt) { Enabled = settings.ForwardClicks };

        if (settings.WallpaperOn && settings.WallpaperId is { } id) await ShowWallpaperAsync(id);
        watch.Start();
        await HandleAsync(first);
    }

    private WallpaperWindow? WallAt(Point at) =>
        settings.WallpaperOn ? walls.FirstOrDefault(w => !w.IsDisposed && w.IsRunning && w.Screen.Bounds.Contains(at)) : null;

    private async Task HandleAsync(Command command)
    {
        Log.Write($"command {command.Serialize()}");
        switch (command.What)
        {
            case Command.Kind.Wall:
                await PickAsync(command.WorkId!);
                break;
            case Command.Kind.Show:
                ShowPicker();
                break;
            case Command.Kind.Launch:
            case Command.Kind.Startup:
                // Windows の起動で開いたときは、まだ選んでいなければ一覧を出す
                if (settings.WallpaperId is null) ShowPicker();
                break;
            case Command.Kind.Quit:
                Quit();
                break;
        }
    }

    /// <summary>壁紙を選んだ（一覧、ludion://）。選ぶのはオンにしたいということなので、オフならオンにする。</summary>
    private async Task PickAsync(string id)
    {
        if (settings.WallpaperId != id) previousId = settings.WallpaperId;
        settings.WallpaperId = id;
        settings.WallpaperOn = true;
        settings.Paused = false;
        settings.Save();
        await ShowWallpaperAsync(id);
        await WatchAsync();
        SendPickerState();
    }

    /// <summary>
    /// Ludion の壁紙のオンとオフ。オフは壁紙の窓を閉じて、元の Windows の壁紙に戻す（アプリは通知領域に残る）。
    /// オンに戻すと、選んでいた壁紙に戻る。まだ選んでいなければ一覧を出す。
    /// </summary>
    private async Task SetWallpaperOnAsync(bool on)
    {
        settings.WallpaperOn = on;
        settings.Save();
        Log.Write($"wallpaper on={on}");
        if (!on)
        {
            CloseWalls();
        }
        else if (settings.WallpaperId is { } id)
        {
            await ShowWallpaperAsync(id);
            await WatchAsync();
        }
        else
        {
            ShowPicker();
        }
        SendPickerState();
    }

    private void ShowPicker()
    {
        if (environment is null) return;
        if (picker is { IsDisposed: false })
        {
            if (picker.WindowState == FormWindowState.Minimized) picker.WindowState = FormWindowState.Normal;
            picker.Activate();
            return;
        }
        picker = new PickerWindow(environment, () => settings.WallpaperId, PickerState, id => _ = PickAsync(id), OnPickerSet);
        picker.FormClosed += (_, _) => picker = null;
        picker.Show();
        picker.Activate();
    }

    /// <summary>一覧の上の2つの切り替え（Ludion の壁紙、Windows の起動で始める）の今の値。</summary>
    private PickerState PickerState() =>
        new("state", settings.WallpaperOn, IsStartWithWindows(), StartupInWindowsSettings: Native.IsPackaged());

    private void SendPickerState()
    {
        if (picker is { IsDisposed: false }) picker.SendState();
    }

    private void OnPickerSet(string key, bool value)
    {
        switch (key)
        {
            case "on":
                _ = SetWallpaperOnAsync(value);
                break;
            case "startup":
                SetStartWithWindows(value);
                break;
        }
    }

    /// <summary>画面ごとに壁紙を出す。もう出ていれば、住所だけ変える。</summary>
    private async Task ShowWallpaperAsync(string id)
    {
        if (environment is null || !settings.WallpaperOn) return;
        var screens = Screen.AllScreens;
        // 画面の数や場所が変わっていたら作り直す
        var same = walls.Count == screens.Length && walls.Zip(screens).All(pair => pair.First.Screen.DeviceName == pair.Second.DeviceName && pair.First.Screen.Bounds == pair.Second.Bounds);
        if (!same) CloseWalls();
        if (walls.Count == 0)
        {
            foreach (var screen in screens)
            {
                var wall = new WallpaperWindow(screen, environment, id, settings.Muted);
                wall.NotFound += OnNotFound;
                walls.Add(wall);
                await wall.StartAsync();
            }
        }
        else
        {
            foreach (var wall in walls)
            {
                wall.Open(id);
                await wall.SetRunningAsync(true);
            }
        }
    }

    /// <summary>
    /// 選んだ作品がない（住所の打ち間違い、取り下げ）。前の壁紙に戻す。前がなければ外して、一覧を出す。
    /// </summary>
    private void OnNotFound(string id)
    {
        if (settings.WallpaperId != id) return;
        Log.Write($"not found {id}, back to {previousId ?? "(none)"}");
        settings.WallpaperId = previousId != id ? previousId : null;
        previousId = null;
        settings.Save();
        ui.BeginInvoke(async () =>
        {
            if (settings.WallpaperId is { } back)
            {
                await ShowWallpaperAsync(back);
            }
            else
            {
                CloseWalls();
                ShowPicker();
            }
        });
    }

    private void CloseWalls()
    {
        if (walls.Count == 0) return;
        foreach (var wall in walls) wall.Dispose();
        walls.Clear();
        // ふだんの壁紙を描き直す（古い Windows では、外した後も最後の絵が残るため）。開発の確かめでデスクトップに付けていないときは触らない
        if (!WallpaperWindow.NoDesktop) Native.RefreshDesktopWallpaper();
    }

    /// <summary>
    /// 1秒ごとに、止めるかを決める（APP001「4」）。止めるのは：本人が一時停止した、電池で動いている（設定）、
    /// 画面が鍵で閉じている、全画面のアプリやゲームの間、その画面が窓で全部隠れている。
    /// </summary>
    private async Task WatchAsync()
    {
        if (walls.Count == 0 || rebuilding) return;
        foreach (var wall in walls) wall.Attach();

        var battery = settings.PauseOnBattery && SystemInformation.PowerStatus.PowerLineStatus == PowerLineStatus.Offline;
        var fullScreen = Desktop.IsFullScreenAppRunning();
        var everywhere = settings.Paused || battery || locked || fullScreen;
        var ours = walls.Select(w => w.Handle).ToHashSet();
        var covered = everywhere || WallpaperWindow.NoDesktop
            ? new bool[walls.Count]
            : Desktop.CoveredScreens(walls.Select(w => w.Screen.WorkingArea).ToList(), ours);
        for (var i = 0; i < walls.Count; i++)
        {
            var run = !everywhere && !covered[i];
            if (run != walls[i].IsRunning)
            {
                Log.Write($"state {walls[i].Screen.DeviceName} run={run} paused={settings.Paused} battery={battery} locked={locked} fullscreen={fullScreen} covered={covered[i]}");
            }
            await walls[i].SetRunningAsync(run);
        }
    }

    private async void OnDisplayChanged(object? sender, EventArgs e)
    {
        if (!settings.WallpaperOn || settings.WallpaperId is not { } id || rebuilding) return;
        rebuilding = true;
        try
        {
            // 画面の付け外しの直後は値が揃わないことがあるので、少し待つ
            await Task.Delay(1500);
            await ShowWallpaperAsync(id);
            foreach (var wall in walls)
            {
                var screen = Screen.AllScreens.FirstOrDefault(s => s.DeviceName == wall.Screen.DeviceName);
                if (screen is not null) wall.MoveTo(screen);
            }
        }
        finally
        {
            rebuilding = false;
        }
    }

    private void OnSessionSwitch(object? sender, SessionSwitchEventArgs e)
    {
        if (e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect) locked = true;
        if (e.Reason is SessionSwitchReason.SessionUnlock or SessionSwitchReason.ConsoleConnect or SessionSwitchReason.RemoteConnect) locked = false;
        ui.BeginInvoke(() => _ = WatchAsync());
    }

    private void OnPowerModeChanged(object? sender, PowerModeChangedEventArgs e) => ui.BeginInvoke(() => _ = WatchAsync());

    private void RefreshMenu()
    {
        onItem.Checked = settings.WallpaperOn;
        pauseItem.Checked = settings.Paused;
        soundItem.Checked = !settings.Muted;
        clicksItem.Checked = settings.ForwardClicks;
        batteryItem.Checked = settings.PauseOnBattery;
        startupItem.Checked = IsStartWithWindows();
        // 一時停止、音、クリックは、壁紙がオンで選んであるときだけ
        pauseItem.Enabled = soundItem.Enabled = clicksItem.Enabled = settings.WallpaperOn && settings.WallpaperId is not null;
    }

    private void TogglePause()
    {
        settings.Paused = !settings.Paused;
        settings.Save();
        _ = WatchAsync();
    }

    private void ToggleSound()
    {
        settings.Muted = !settings.Muted;
        settings.Save();
        foreach (var wall in walls) wall.SetMuted(settings.Muted);
    }

    private void ToggleClicks()
    {
        settings.ForwardClicks = !settings.ForwardClicks;
        settings.Save();
        if (input is not null) input.Enabled = settings.ForwardClicks;
    }

    private void ToggleBattery()
    {
        settings.PauseOnBattery = !settings.PauseOnBattery;
        settings.Save();
        _ = WatchAsync();
    }

    /// <summary>Store から入れたときは、Windows の「スタートアップ」の設定が受け持つ（初めは始める。MSIX の決まり）。</summary>
    private static bool IsStartWithWindows() => Native.IsPackaged() || Installer.IsStartWithWindows();

    private void SetStartWithWindows(bool value)
    {
        if (Native.IsPackaged())
        {
            Process.Start(new ProcessStartInfo("ms-settings:startupapps") { UseShellExecute = true });
        }
        else
        {
            Installer.SetStartWithWindows(value);
        }
        SendPickerState();
    }

    private static void OpenSite() =>
        Process.Start(new ProcessStartInfo(Links.SiteWallpapers().AbsoluteUri) { UseShellExecute = true });

    private void Quit()
    {
        watch.Stop();
        SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        input?.Dispose();
        input = null;
        picker?.Close();
        CloseWalls();
        tray.Visible = false;
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            watch.Dispose();
            tray.Dispose();
            ui.Dispose();
            input?.Dispose();
            foreach (var wall in walls) wall.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal static class AppIcon
{
    private static Icon? tray;
    private static Icon? window;

    public static Icon Tray => tray ??= Load(SystemInformation.SmallIconSize);

    public static Icon Window => window ??= Load(SystemInformation.IconSize);

    private static Icon Load(Size size)
    {
        using var stream = typeof(AppIcon).Assembly.GetManifestResourceStream("tray.ico")!;
        return new Icon(stream, size);
    }
}
