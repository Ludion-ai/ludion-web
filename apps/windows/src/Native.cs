using System.Runtime.InteropServices;
using System.Text;

namespace Ludion.Wallpaper;

/// <summary>Windows の API。壁紙をアイコンの後ろに置く、全画面を見る、の2つに使う。</summary>
internal static partial class Native
{
    public const int GWL_STYLE = -16;
    public const int GWL_EXSTYLE = -20;
    public const long WS_CHILD = 0x40000000L;
    public const long WS_POPUP = 0x80000000L;
    public const long WS_CAPTION = 0x00C00000L;
    public const long WS_THICKFRAME = 0x00040000L;
    public const long WS_EX_LAYERED = 0x00080000L;
    public const long WS_EX_TRANSPARENT = 0x00000020L;
    public const long WS_EX_TOOLWINDOW = 0x00000080L;
    public const long WS_EX_NOACTIVATE = 0x08000000L;
    public const long WS_EX_APPWINDOW = 0x00040000L;
    public const uint LWA_ALPHA = 0x2;

    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_FRAMECHANGED = 0x0020;

    public const uint SMTO_NORMAL = 0x0000;
    public const uint SPI_GETDESKWALLPAPER = 0x0073;
    public const uint SPI_SETDESKWALLPAPER = 0x0014;
    public const uint SPIF_UPDATEINIFILE = 0x01;

    public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    public const int DWMWA_CLOAKED = 14;

    public const int APPMODEL_ERROR_NO_PACKAGE = 15700;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
        public readonly Rectangle ToRectangle() => Rectangle.FromLTRB(Left, Top, Right, Bottom);
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [LibraryImport("user32.dll", EntryPoint = "FindWindowW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial IntPtr FindWindow(string? className, string? windowName);

    [LibraryImport("user32.dll", EntryPoint = "FindWindowExW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string? className, string? windowName);

    [LibraryImport("user32.dll", EntryPoint = "SendMessageTimeoutW")]
    public static partial IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsChild(IntPtr parent, IntPtr hWnd);

    [LibraryImport("user32.dll", SetLastError = true)]
    public static partial IntPtr SetParent(IntPtr child, IntPtr newParent);

    [LibraryImport("user32.dll")]
    public static partial IntPtr GetParent(IntPtr hWnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsWindow(IntPtr hWnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsWindowVisible(IntPtr hWnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsIconic(IntPtr hWnd);

    [LibraryImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    public static partial IntPtr GetWindowLongPtr(IntPtr hWnd, int index);

    [LibraryImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    public static partial IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetLayeredWindowAttributes(IntPtr hWnd, uint key, byte alpha, uint flags);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

    [LibraryImport("user32.dll")]
    public static partial int MapWindowPoints(IntPtr from, IntPtr to, ref RECT points, uint count);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [LibraryImport("user32.dll")]
    public static partial IntPtr GetForegroundWindow();

    [LibraryImport("user32.dll")]
    public static partial uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [LibraryImport("user32.dll", EntryPoint = "GetClassNameW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial int GetClassName(IntPtr hWnd, [Out] char[] buffer, int max);

    [LibraryImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SystemParametersInfo(uint action, uint param, [In, Out] char[]? buffer, uint winIni);

    [LibraryImport("dwmapi.dll")]
    public static partial int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);

    [LibraryImport("dwmapi.dll")]
    public static partial int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

    [LibraryImport("dwmapi.dll")]
    public static partial int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);

    public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

    /// <summary>Windows のアプリの色がダークか。</summary>
    public static bool AppsUseDarkTheme()
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
    }

    /// <summary>全画面のアプリ、ゲーム、発表の間かを Windows に聞く。</summary>
    [LibraryImport("shell32.dll")]
    public static partial int SHQueryUserNotificationState(out int state);

    public const int QUNS_BUSY = 2;
    public const int QUNS_RUNNING_D3D_FULL_SCREEN = 3;
    public const int QUNS_PRESENTATION_MODE = 4;

    [LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16)]
    public static partial int GetCurrentPackageFullName(ref int length, [Out] char[]? name);

    public static string ClassName(IntPtr hWnd)
    {
        var buffer = new char[256];
        var length = GetClassName(hWnd, buffer, buffer.Length);
        return length > 0 ? new string(buffer, 0, length) : string.Empty;
    }

    public static long Style(IntPtr hWnd) => GetWindowLongPtr(hWnd, GWL_STYLE).ToInt64();

    public static long ExStyle(IntPtr hWnd) => GetWindowLongPtr(hWnd, GWL_EXSTYLE).ToInt64();

    /// <summary>MSIX で入っている（Store から入れた）か。</summary>
    public static bool IsPackaged()
    {
        var length = 0;
        return GetCurrentPackageFullName(ref length, null) != APPMODEL_ERROR_NO_PACKAGE;
    }

    /// <summary>今の壁紙の画像の場所。壁紙を外した後に、デスクトップを描き直すために使う。</summary>
    public static string? CurrentDesktopWallpaper()
    {
        var buffer = new char[1024];
        if (!SystemParametersInfo(SPI_GETDESKWALLPAPER, (uint)buffer.Length, buffer, 0)) return null;
        var end = Array.IndexOf(buffer, '\0');
        return new string(buffer, 0, end < 0 ? buffer.Length : end);
    }

    public static void RefreshDesktopWallpaper()
    {
        var path = CurrentDesktopWallpaper();
        if (path is null) return;
        var buffer = (path + '\0').ToCharArray();
        SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, buffer, SPIF_UPDATEINIFILE);
    }

    public static string Describe(IntPtr hWnd)
    {
        var builder = new StringBuilder();
        builder.Append("0x").Append(hWnd.ToString("x")).Append(' ').Append(ClassName(hWnd));
        return builder.ToString();
    }
}
