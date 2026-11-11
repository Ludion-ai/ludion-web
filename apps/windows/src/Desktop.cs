namespace Ludion.Wallpaper;

/// <summary>
/// 窓を、デスクトップのアイコンの後ろに置く。
///
/// Progman（デスクトップの窓）に 0x052C を送ると、Windows は壁紙を描く WorkerW を作る。
/// - Windows 11 24H2 から：WorkerW は Progman の子になる。壁紙の窓を Progman の子にし、
///   アイコン（SHELLDLL_DefView）のすぐ下、WorkerW の上に置く。Progman の子は重ねて描かれるので、窓を layered にする。
/// - それより前：WorkerW は上の段の窓で、アイコンを持つ窓のすぐ後ろにある。壁紙の窓をその WorkerW の子にする。
/// </summary>
internal static class Desktop
{
    private const uint SpawnWorkerW = 0x052C;

    public sealed record Host(IntPtr Parent, IntPtr WorkerW, bool Raised);

    /// <summary>壁紙を置く親を探す。見つからなければ null（explorer が動いていないときなど）。</summary>
    public static Host? Find()
    {
        var progman = Native.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return null;

        // 壁紙の WorkerW を作ってもらう（もうあれば何も起きない）
        Native.SendMessageTimeout(progman, SpawnWorkerW, new IntPtr(0xD), new IntPtr(0x1), Native.SMTO_NORMAL, 1000, out _);
        Native.SendMessageTimeout(progman, SpawnWorkerW, IntPtr.Zero, IntPtr.Zero, Native.SMTO_NORMAL, 1000, out _);

        // 24H2 から
        var childWorkerW = Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        if (childWorkerW != IntPtr.Zero) return new Host(progman, childWorkerW, Raised: true);

        // それより前
        var workerW = IntPtr.Zero;
        Native.EnumWindows((top, _) =>
        {
            if (Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
            {
                workerW = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
            }
            return true;
        }, IntPtr.Zero);
        return workerW != IntPtr.Zero ? new Host(workerW, workerW, Raised: false) : null;
    }

    /// <summary>窓を親の子にし、画面（スクリーンの座標）の場所に合わせる。</summary>
    public static void Attach(IntPtr window, Host host, Rectangle screenBounds)
    {
        var style = Native.Style(window);
        style = (style | Native.WS_CHILD) & ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME);
        Native.SetWindowLongPtr(window, Native.GWL_STYLE, new IntPtr(style));

        var exStyle = Native.ExStyle(window) & ~Native.WS_EX_APPWINDOW;
        exStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
        if (host.Raised) exStyle |= Native.WS_EX_LAYERED;
        Native.SetWindowLongPtr(window, Native.GWL_EXSTYLE, new IntPtr(exStyle));
        if (host.Raised) Native.SetLayeredWindowAttributes(window, 0, 255, Native.LWA_ALPHA);

        Native.SetParent(window, host.Parent);
        Place(window, host, screenBounds);
    }

    public static void Place(IntPtr window, Host host, Rectangle screenBounds)
    {
        // 親の中の座標に直す（いくつもの画面があると、親の左上は 0,0 ではない）
        var rect = new Native.RECT { Left = screenBounds.Left, Top = screenBounds.Top, Right = screenBounds.Right, Bottom = screenBounds.Bottom };
        Native.MapWindowPoints(IntPtr.Zero, host.Parent, ref rect, 2);

        if (host.Raised)
        {
            // アイコンのすぐ下に置き、WorkerW（ふだんの壁紙）をその下に回す
            var icons = Native.FindWindowEx(host.Parent, IntPtr.Zero, "SHELLDLL_DefView", null);
            Native.SetWindowPos(window, icons, rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top,
                Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
            Native.SetWindowPos(host.WorkerW, window, 0, 0, 0, 0, Native.SWP_NOACTIVATE | Native.SWP_NOMOVE | Native.SWP_NOSIZE);
        }
        else
        {
            Native.SetWindowPos(window, IntPtr.Zero, rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top,
                Native.SWP_NOACTIVATE | Native.SWP_NOZORDER | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
        }
    }

    /// <summary>親がまだ生きているか（explorer が立ち直ると、親は作り直される）。</summary>
    public static bool IsAlive(Host host, IntPtr window) =>
        Native.IsWindow(host.Parent) && Native.GetParent(window) == host.Parent;

    private static readonly HashSet<string> ShellClasses =
    [
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
        "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland", "NotifyIconOverflowWindow",
    ];

    /// <summary>
    /// 全画面のアプリやゲーム、発表の間か（Windows がそう言っているか）。どの画面でも、壁紙を全部止める。
    /// </summary>
    public static bool IsFullScreenAppRunning()
    {
        if (Native.SHQueryUserNotificationState(out var state) != 0) return false;
        return state is Native.QUNS_BUSY or Native.QUNS_RUNNING_D3D_FULL_SCREEN or Native.QUNS_PRESENTATION_MODE;
    }

    /// <summary>
    /// 画面ごとに、壁紙が隠れているか。最大化した窓か全画面の窓が、作業の場所を全部覆っていれば隠れている。
    /// 見えない窓、最小化した窓、隠した（cloaked）窓、押しても下に通る重ねの窓は数えない。
    /// </summary>
    public static bool[] CoveredScreens(IReadOnlyList<Rectangle> workAreas, ISet<IntPtr> ours)
    {
        var covered = new bool[workAreas.Count];
        var self = (uint)Environment.ProcessId;
        Native.EnumWindows((window, _) =>
        {
            if (ours.Contains(window) || !Native.IsWindowVisible(window) || Native.IsIconic(window)) return true;
            Native.GetWindowThreadProcessId(window, out var process);
            if (process == self) return true;
            if (Native.DwmGetWindowAttribute(window, Native.DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
            var ex = Native.ExStyle(window);
            if ((ex & Native.WS_EX_TRANSPARENT) != 0) return true;
            if (ShellClasses.Contains(Native.ClassName(window))) return true;
            if (Native.DwmGetWindowAttribute(window, Native.DWMWA_EXTENDED_FRAME_BOUNDS, out Native.RECT frame, System.Runtime.InteropServices.Marshal.SizeOf<Native.RECT>()) != 0)
            {
                if (!Native.GetWindowRect(window, out frame)) return true;
            }
            var bounds = frame.ToRectangle();
            for (var i = 0; i < workAreas.Count; i++)
            {
                if (!covered[i] && bounds.Contains(workAreas[i])) covered[i] = true;
            }
            return true;
        }, IntPtr.Zero);
        return covered;
    }
}
