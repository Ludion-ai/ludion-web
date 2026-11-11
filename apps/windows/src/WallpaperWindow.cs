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
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.NavigationCompleted += (_, e) =>
        {
            Log.Write($"wall {Screen.DeviceName} {workId} loaded={e.IsSuccess} status={e.HttpStatusCode}");
            if (e.IsSuccess) return;
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

    /// <summary>アイコンの後ろに付ける。explorer が立ち直って親が消えていたら、付け直す。</summary>
    public void Attach()
    {
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
