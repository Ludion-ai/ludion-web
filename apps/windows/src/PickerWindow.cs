using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Ludion.Wallpaper;

/// <summary>
/// 壁紙を選ぶ窓（APP001「2」）。一覧の絵はアプリの中の picker.html。中身（/api/works）はアプリが読んで渡す。
/// 上に2つの切り替え：Ludion の壁紙のオンとオフ、Windows の起動で始める。値はアプリが持ち、変わるたびに渡す。
/// </summary>
internal sealed class PickerWindow : Form
{
    private readonly WebView2 view;
    private readonly CoreWebView2Environment environment;
    private readonly Func<string?> current;
    private readonly Action<string> onPick;
    private readonly Func<PickerState> state;
    private readonly Action<string, bool> onSet;

    public PickerWindow(CoreWebView2Environment environment, Func<string?> current, Func<PickerState> state, Action<string> onPick, Action<string, bool> onSet)
    {
        this.environment = environment;
        this.current = current;
        this.state = state;
        this.onPick = onPick;
        this.onSet = onSet;
        Text = Strings.Current.PickerTitle;
        Icon = AppIcon.Window;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Color.White;
        view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White, AllowExternalDrop = false };
        Controls.Add(view);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // 大きさは 96 DPI の値を、開いた画面の DPI に合わせて広げる（4K の 150% でも同じ見た目の大きさ）。作業の場所に収める
        var scale = DeviceDpi / 96f;
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        var size = new Size(Math.Min((int)(1040 * scale), area.Width), Math.Min((int)(720 * scale), area.Height));
        MinimumSize = new Size((int)(560 * scale), (int)(480 * scale));
        Bounds = new Rectangle(area.Left + (area.Width - size.Width) / 2, area.Top + (area.Height - size.Height) / 2, size.Width, size.Height);
        // 一覧のページは Windows の色に合わせる（picker.html の prefers-color-scheme）。窓の枠も合わせる
        if (!Native.AppsUseDarkTheme()) return;
        var dark = 1;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
        BackColor = Color.FromArgb(0x0f, 0x0f, 0x12);
        view.DefaultBackgroundColor = BackColor;
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        await view.EnsureCoreWebView2Async(environment);
        var core = view.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("LUDION_DEVTOOLS") == "1";
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.DownloadStarting += (_, args) => args.Cancel = true;
        core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        // 一覧のページだけ（about:blank に文字で入れたもの）。ほかへは移らない
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith("data:", StringComparison.Ordinal) && args.Uri != "about:blank") args.Cancel = true;
        };
        core.WebMessageReceived += OnMessage;
        core.NavigationCompleted += async (_, _) =>
        {
            SendState();
            await SendWorksAsync();
        };
        core.NavigateToString(PageHtml());
    }

    private static string PageHtml()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("picker.html")!;
        using var reader = new StreamReader(stream);
        var origin = Links.Origin;
        return reader.ReadToEnd()
            .Replace("__ORIGIN__", origin, StringComparison.Ordinal)
            .Replace("__LANG__", Strings.Current.Lang, StringComparison.Ordinal);
    }

    /// <summary>切り替えの今の値を、一覧のページに渡す（通知領域から変えたときも）。</summary>
    public void SendState()
    {
        if (IsDisposed || view.CoreWebView2 is not { } core) return;
        core.PostWebMessageAsJson(JsonSerializer.Serialize(state(), CatalogJson.Default.PickerState));
    }

    private async Task SendWorksAsync()
    {
        if (view.CoreWebView2 is not { } core) return;
        string json;
        try
        {
            var works = await Catalog.LoadAsync();
            json = JsonSerializer.Serialize(new PickerMessage("works", Strings.Current.Lang, current(), works), CatalogJson.Default.PickerMessage);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or NotSupportedException)
        {
            Log.Write($"catalog: {error.Message}");
            json = JsonSerializer.Serialize(new PickerMessage("error", Strings.Current.Lang, current(), []), CatalogJson.Default.PickerMessage);
        }
        if (!IsDisposed) core.PostWebMessageAsJson(json);
    }

    /// <summary>一覧のページからの知らせ。形を確かめてから使う（CLAUDE.md「親とiframeのやりとり」と同じ考え）。</summary>
    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type)) return;
            switch (type.GetString())
            {
                case "pick" when root.TryGetProperty("id", out var id) && Links.IsWorkId(id.GetString()):
                    onPick(id.GetString()!);
                    break;
                case "site":
                    Process.Start(new ProcessStartInfo(Links.SiteWallpapers().AbsoluteUri) { UseShellExecute = true });
                    break;
                case "retry":
                    await SendWorksAsync();
                    break;
                case "set" when root.TryGetProperty("key", out var key) && key.GetString() is "on" or "startup"
                    && root.TryGetProperty("value", out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False:
                    onSet(key.GetString()!, value.GetBoolean());
                    break;
            }
        }
        catch (JsonException)
        {
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) view.Dispose();
        base.Dispose(disposing);
    }
}
