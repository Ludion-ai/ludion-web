using System.Runtime.InteropServices;

namespace Ludion.Wallpaper;

/// <summary>
/// デスクトップの何もない所でのマウスを、壁紙の WebView2 に渡す（APP001。ガラスを割る、音を始める）。
///
/// - 見るだけ：Raw Input（RIDEV_INPUTSINK）でマウスの動きとボタンを受け取る。入力を横取りしないので、デスクトップにもそのまま届く
///   （アイコンを選ぶ、右クリックのメニュー、ダブルクリックで開く、は今までどおり）。
/// - 渡す先：壁紙の窓の中の Chromium の入力の窓（Chrome_WidgetWin_1）に、本物と同じ窓のメッセージ（WM_LBUTTONDOWN など）を送る。
///   ページの中では本物の操作（isTrusted、ユーザーの操作の扱い）になるので、音も始められる。JS で作った合成のイベントではない。
/// - 渡すのは左のボタンと動きだけ。右と真ん中のボタン、ホイールは渡さない。
/// - 渡さない所：ほかの窓の上、タスクバーの上、アイコンの上（アイコンの一覧が「カーソルの下のアイコン」を持っている）。
///   押した直後にアイコンが選ばれた（押したのがアイコン）ときも渡さない。何もない所を押すと、Windows は選びを外すので、それで分かる。
///   どちらも、ポインタを渡さない問い合わせ（LVM_GETHOTITEM、LVM_GETSELECTEDCOUNT）だけで、explorer のメモリーには触らない。
/// </summary>
internal sealed class DesktopInput : NativeWindow, IDisposable
{
    private const int WM_INPUT = 0x00FF;
    private const uint RID_INPUT = 0x10000003;
    private const uint RIDEV_INPUTSINK = 0x00000100;
    private const uint RIDEV_REMOVE = 0x00000001;
    private const ushort RI_MOUSE_LEFT_BUTTON_DOWN = 0x0001;
    private const ushort RI_MOUSE_LEFT_BUTTON_UP = 0x0002;

    public const uint WM_MOUSEMOVE = 0x0200;
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP = 0x0202;
    public const int MK_LBUTTON = 0x0001;

    private const uint LVM_GETSELECTEDCOUNT = 0x1032;
    private const uint LVM_GETHOTITEM = 0x103D;

    /// <summary>押した後、explorer が押したことを受け取るまで待つ時間（アイコンを押したかを、選ばれたかで見る）。</summary>
    private const int ConfirmMs = 40;

    /// <summary>動きを渡す間かく（多すぎると explorer への問い合わせが増える）。</summary>
    private const long MoveIntervalMs = 16;

    private readonly Func<Point, WallpaperWindow?> wallAt;
    private readonly System.Windows.Forms.Timer confirm = new() { Interval = ConfirmMs };
    private WallpaperWindow? pressed;
    private WallpaperWindow? pendingWall;
    private Point pendingDown;
    private IntPtr pendingList;
    private Point? pendingUp;
    private long lastMove;

    public bool Enabled { get; set; }

    public DesktopInput(Func<Point, WallpaperWindow?> wallAt)
    {
        this.wallAt = wallAt;
        confirm.Tick += (_, _) => Confirm();
        // 見えない窓（Raw Input を受ける。メッセージだけの窓では INPUTSINK が届かないことがあるので、ふつうの見えない窓にする）
        CreateHandle(new CreateParams { Caption = "Ludion input", ExStyle = (int)Native.WS_EX_TOOLWINDOW });
        var device = new RAWINPUTDEVICE { UsagePage = 0x01, Usage = 0x02, Flags = RIDEV_INPUTSINK, Target = Handle };
        if (!RegisterRawInputDevices([device], 1, (uint)Marshal.SizeOf<RAWINPUTDEVICE>()))
        {
            Log.Write($"input: register failed {Marshal.GetLastWin32Error()}");
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_INPUT)
        {
            try
            {
                OnRawInput(m.LParam);
            }
            catch (Exception error) when (error is ExternalException or InvalidOperationException)
            {
                Log.Write($"input: {error.Message}");
            }
        }
        base.WndProc(ref m);
    }

    private void OnRawInput(IntPtr handle)
    {
        if (!Enabled)
        {
            pressed = null;
            return;
        }
        // RAWINPUTHEADER（x64 で 24 バイト）の後に RAWMOUSE。ボタンの印は 28 バイト目から
        var header = (uint)Marshal.SizeOf<RAWINPUTHEADER>();
        var size = 0u;
        if (GetRawInputData(handle, RID_INPUT, IntPtr.Zero, ref size, header) != 0 || size == 0 || size > 256) return;
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (GetRawInputData(handle, RID_INPUT, buffer, ref size, header) != size) return;
            var raw = Marshal.PtrToStructure<RAWINPUTHEADER>(buffer);
            if (raw.Type != 0) return; // マウスだけ
            var buttons = (ushort)Marshal.ReadInt16(buffer, (int)header + 4);
            GetCursorPos(out var point);
            var at = new Point(point.X, point.Y);
            if ((buttons & RI_MOUSE_LEFT_BUTTON_DOWN) != 0) OnDown(at);
            if ((buttons & RI_MOUSE_LEFT_BUTTON_UP) != 0) OnUp(at);
            if (buttons == 0) OnMove(at);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private void OnDown(Point at)
    {
        if (confirm.Enabled) return;
        if (!IsEmptyDesktop(at, out var list) || wallAt(at) is not { } wall) return;
        pendingWall = wall;
        pendingDown = at;
        pendingList = list;
        pendingUp = null;
        confirm.Start();
    }

    /// <summary>explorer が押したことを受け取った後に見る。アイコンが選ばれていなければ、何もない所を押した。</summary>
    private void Confirm()
    {
        confirm.Stop();
        var wall = pendingWall;
        pendingWall = null;
        if (wall is null || wall.IsDisposed) return;
        if (pendingList != IntPtr.Zero && (Query(pendingList, LVM_GETSELECTEDCOUNT) > 0 || Query(pendingList, LVM_GETHOTITEM) >= 0))
        {
            Log.Write("input: on an icon, not passed");
            return;
        }
        Post(wall, WM_MOUSEMOVE, 0, pendingDown);
        Post(wall, WM_LBUTTONDOWN, MK_LBUTTON, pendingDown);
        pressed = wall;
        if (pendingUp is { } up)
        {
            Post(wall, WM_LBUTTONUP, 0, up);
            pressed = null;
        }
    }

    private void OnUp(Point at)
    {
        if (confirm.Enabled)
        {
            pendingUp = at;
            return;
        }
        if (pressed is not { IsDisposed: false } wall) return;
        Post(wall, WM_LBUTTONUP, 0, at);
        pressed = null;
    }

    private void OnMove(Point at)
    {
        var now = Environment.TickCount64;
        if (now - lastMove < MoveIntervalMs) return;
        lastMove = now;
        if (pressed is { IsDisposed: false } held)
        {
            Post(held, WM_MOUSEMOVE, MK_LBUTTON, at);
            return;
        }
        if (IsEmptyDesktop(at, out _) && wallAt(at) is { } wall) Post(wall, WM_MOUSEMOVE, 0, at);
    }

    /// <summary>
    /// カーソルの下がデスクトップの何もない所か。いちばん上の窓がデスクトップ（アイコンの一覧、その入れ物、Progman、WorkerW）で、
    /// アイコンの一覧が「カーソルの下のアイコン」を持っていないとき。
    /// </summary>
    internal static bool IsEmptyDesktop(Point at, out IntPtr list)
    {
        list = IntPtr.Zero;
        var top = WindowFromPoint(new POINT { X = at.X, Y = at.Y });
        if (top == IntPtr.Zero) return false;
        var root = GetAncestor(top, GA_ROOT);
        var rootClass = Native.ClassName(root);
        if (rootClass != "Progman" && rootClass != "WorkerW") return false;
        var cls = Native.ClassName(top);
        if (cls == "SysListView32") list = top;
        else if (cls == "SHELLDLL_DefView") list = Native.FindWindowEx(top, IntPtr.Zero, "SysListView32", null);
        return list == IntPtr.Zero || Query(list, LVM_GETHOTITEM) < 0;
    }

    private static long Query(IntPtr list, uint message)
    {
        // explorer が止まっていても待ち続けない
        return SendMessageTimeout(list, message, IntPtr.Zero, IntPtr.Zero, 0x0002 /* SMTO_ABORTIFHUNG */, 50, out var result) == IntPtr.Zero
            ? 0
            : result.ToInt64();
    }

    /// <summary>壁紙の Chromium の入力の窓に、スクリーンの座標 at の操作を送る。</summary>
    internal static void Post(WallpaperWindow wall, uint message, int keys, Point at)
    {
        var target = wall.InputWindow();
        if (target == IntPtr.Zero) return;
        var point = new POINT { X = at.X, Y = at.Y };
        ScreenToClient(target, ref point);
        var lParam = (IntPtr)(((point.Y & 0xFFFF) << 16) | (point.X & 0xFFFF));
        PostMessage(target, message, keys, lParam);
    }

    public void Dispose()
    {
        confirm.Dispose();
        if (Handle != IntPtr.Zero)
        {
            var device = new RAWINPUTDEVICE { UsagePage = 0x01, Usage = 0x02, Flags = RIDEV_REMOVE, Target = IntPtr.Zero };
            RegisterRawInputDevices([device], 1, (uint)Marshal.SizeOf<RAWINPUTDEVICE>());
            DestroyHandle();
        }
    }

    private const uint GA_ROOT = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X, Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICE
    {
        public ushort UsagePage;
        public ushort Usage;
        public uint Flags;
        public IntPtr Target;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTHEADER
    {
        public uint Type;
        public uint Size;
        public IntPtr Device;
        public IntPtr WParam;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);

    [DllImport("user32.dll")]
    private static extern uint GetRawInputData(IntPtr rawInput, uint command, IntPtr data, ref uint size, uint headerSize);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(POINT point);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

    [DllImport("user32.dll")]
    private static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint message, int wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
}
