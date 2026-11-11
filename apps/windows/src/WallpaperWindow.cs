using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Ludion.Wallpaper;

/// <summary>
/// 1つの画面の壁紙。デスクトップのアイコンの後ろで、作品の全画面の住所（/p/&lt;id&gt;/wall）を画面いっぱいに出す。
/// 作品の JS は、そのページの中の守りの枠（sandbox、CSP）で動く（CLAUDE.md「描画」）。このアプリは住所を開くだけ。
/// </summary>
internal sealed class WallpaperWindow : Form
{
    private readonly WebView2 view;
    private readonly CoreWebView2Environment environment;
    private readonly SemaphoreSlim stateGate = new(1, 1);
    private Desktop.Host? host;
    private string workId;
    private bool muted;
    private bool wantRunning = true;
    private bool running = true;
    private System.Windows.Forms.Timer? retry;

    public Screen Screen { get; private set; }

    /// <summary>作品が見つからなかった（404）。</summary>
    public event Action<string>? NotFound;

    public WallpaperWindow(Screen screen, CoreWebView2Environment environment, string workId, bool muted)
    {
        Screen = screen;
        this.environment = environment;
        this.workId = workId;
        this.muted = muted;

        Text = "Ludion wallpaper";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        // 親に付けるまでは画面の外に置く（一瞬でも窓の上に出ないように）
        Bounds = new Rectangle(-32000, -32000, screen.Bounds.Width, screen.Bounds.Height);
        BackColor = Color.Black;
        BackgroundImageLayout = ImageLayout.Stretch;

        view = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.Black,
            AllowExternalDrop = false,
        };
        Controls.Add(view);
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            parameters.ExStyle |= (int)(Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE);
            return parameters;
        }
    }

    public async Task StartAsync()
    {
        Show();
        Attach();
        await view.EnsureCoreWebView2Async(environment);
        var core = view.CoreWebView2;
        var settings = core.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("LUDION_DEVTOOLS") == "1";
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.AreDefaultScriptDialogsEnabled = false;
        settings.IsBuiltInErrorPageEnabled = false;
        core.IsMuted = muted;

        // その作品の全画面の住所だけを開く。ほかへ移らない、新しい窓を開かない、保存しない、許可を出さない
        core.NavigationStarting += (_, e) =>
        {
            if (!Links.IsAllowedWallNavigation(e.Uri, workId)) e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        if (DevClick is not null) core.FrameCreated += (_, e) => devFrame = e.Frame;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.NavigationCompleted += (_, e) =>
        {
            Log.Write($"wall {Screen.DeviceName} {workId} loaded={e.IsSuccess} status={e.HttpStatusCode}");
            if (e.IsSuccess)
            {
                if (DevClick is { } point) _ = DevClickAsync(core, point);
                return;
            }
            // ない作品（取り下げた作品も）：読み直さず、アプリに知らせる
            if (e.HttpStatusCode == 404) NotFound?.Invoke(workId);
            else ScheduleRetry();
        };
        core.ProcessFailed += (_, e) =>
        {
            Log.Write($"wall {Screen.DeviceName} process failed {e.ProcessFailedKind}");
            ScheduleRetry();
        };
        Open(workId);
    }

    /// <summary>読めなかったとき（PC を起動した直後でネットがまだ、など）は、少し待って読み直す。</summary>
    private void ScheduleRetry()
    {
        if (retry is not null) return;
        retry = new System.Windows.Forms.Timer { Interval = 30_000 };
        retry.Tick += (_, _) =>
        {
            retry?.Dispose();
            retry = null;
            if (!IsDisposed) Open(workId);
        };
        retry.Start();
    }

    public void Open(string id)
    {
        workId = id;
        view.CoreWebView2?.Navigate(Links.Wall(id).AbsoluteUri);
    }

    public void SetMuted(bool value)
    {
        muted = value;
        if (view.CoreWebView2 is { } core) core.IsMuted = value;
    }

    public void MoveTo(Screen screen)
    {
        Screen = screen;
        if (host is not null) Desktop.Place(Handle, host, screen.Bounds);
    }

    /// <summary>開発の確かめのときだけ：デスクトップに付けず、画面の外の窓のまま動かす（使っている人のデスクトップを変えない）。</summary>
    public static bool NoDesktop { get; } = Environment.GetEnvironmentVariable("LUDION_NO_DESKTOP") == "1";

    /// <summary>開発の確かめのときだけ：読み込みの後、窓の中のこの点を押す（「x,y」。本物のクリックと同じ道で渡す）。</summary>
    private static Point? DevClick { get; } =
        Environment.GetEnvironmentVariable("LUDION_DEV_CLICK") is { } value && value.Split(',') is [var x, var y]
        && int.TryParse(x, out var px) && int.TryParse(y, out var py) ? new Point(px, py) : null;

    private CoreWebView2Frame? devFrame;

    private async Task DevClickAsync(CoreWebView2 core, Point client)
    {
        await Task.Delay(4000);
        // 作品の枠の中で、届いた押し下げが本物の操作か（isTrusted）と、枠の「ユーザーの操作」の印を見る
        const string listen = "window.__ldTrusted = 'none'; addEventListener('pointerdown', e => { window.__ldTrusted = String(e.isTrusted); }, true); 'ok'";
        const string read = "JSON.stringify({ trusted: window.__ldTrusted, active: navigator.userActivation.hasBeenActive })";
        if (devFrame is not null) await devFrame.ExecuteScriptAsync(listen);
        var before = devFrame is null ? "no frame" : await devFrame.ExecuteScriptAsync(read);
        var at = PointToScreen(client);
        DesktopInput.Post(this, DesktopInput.WM_MOUSEMOVE, 0, at);
        DesktopInput.Post(this, DesktopInput.WM_LBUTTONDOWN, DesktopInput.MK_LBUTTON, at);
        await Task.Delay(80);
        DesktopInput.Post(this, DesktopInput.WM_LBUTTONUP, 0, at);
        await Task.Delay(1500);
        var after = devFrame is null ? "no frame" : await devFrame.ExecuteScriptAsync(read);
        Log.Write($"dev click {client} target={Native.Describe(InputWindow())} activation before={before} after={after}");
    }

    private IntPtr input;

    /// <summary>
    /// Chromium がマウスを受ける窓。WebView2 の中の Chrome_WidgetWin_1（その下の Chrome_RenderWidgetHostHWND は
    /// 押しても下に通る窓なので、送り先にしない）。読み込み直しで作り直されるので、そのつど確かめる。
    /// </summary>
    public IntPtr InputWindow()
    {
        if (input != IntPtr.Zero && Native.IsWindow(input) && Native.IsChild(Handle, input)) return input;
        IntPtr best = IntPtr.Zero, fallback = IntPtr.Zero;
        Native.EnumChildWindows(Handle, (child, _) =>
        {
            var cls = Native.ClassName(child);
            if (!cls.StartsWith("Chrome_WidgetWin", StringComparison.Ordinal) || (Native.ExStyle(child) & Native.WS_EX_TRANSPARENT) != 0) return true;
            if (cls == "Chrome_WidgetWin_1") best = child;
            else fallback = child;
            return true;
        }, IntPtr.Zero);
        input = best != IntPtr.Zero ? best : fallback;
        return input;
    }

    /// <summary>アイコンの後ろに付ける。explorer が立ち直って親が消えていたら、付け直す。</summary>
    public void Attach()
    {
        if (NoDesktop) return;
        if (host is not null && Desktop.IsAlive(host, Handle)) return;
        host = Desktop.Find();
        if (host is null)
        {
            Log.Write("desktop not found");
            return;
        }
        Desktop.Attach(Handle, host, Screen.Bounds);
        Log.Write($"attached {Screen.DeviceName} {Screen.Bounds} to {Native.Describe(host.Parent)} raised={host.Raised}");
    }

    public bool IsRunning => running;

    /// <summary>
    /// 動かすか止めるか。止めるときは、今の絵を残してから、ページを隠して眠らせる
    /// （作品は visibilitychange で描くのを止める。CLAUDE.md「動きの決まり」）。
    /// </summary>
    public async Task SetRunningAsync(bool value)
    {
        wantRunning = value;
        await stateGate.WaitAsync();
        try
        {
            if (wantRunning == running || view.CoreWebView2 is not { } core || IsDisposed) return;
            if (!wantRunning)
            {
                await FreezeFrameAsync(core);
                view.Visible = false;
                running = false;
                try
                {
                    await core.TrySuspendAsync();
                }
                catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException)
                {
                    Log.Write($"suspend: {error.Message}");
                }
            }
            else
            {
                core.Resume();
                view.Visible = true;
                running = true;
                // 動きが戻ってから、残した絵を消す
                await Task.Delay(300);
                var frozen = BackgroundImage;
                BackgroundImage = null;
                frozen?.Dispose();
            }
            Log.Write($"wall {Screen.DeviceName} running={running}");
        }
        finally
        {
            stateGate.Release();
        }
    }

    private async Task FreezeFrameAsync(CoreWebView2 core)
    {
        try
        {
            using var stream = new MemoryStream();
            await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Jpeg, stream);
            stream.Position = 0;
            using var image = Image.FromStream(stream);
            var old = BackgroundImage;
            BackgroundImage = new Bitmap(image);
            old?.Dispose();
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            Log.Write($"freeze: {error.Message}");
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            retry?.Dispose();
            view.Dispose();
            BackgroundImage?.Dispose();
            stateGate.Dispose();
        }
        base.Dispose(disposing);
    }
}
