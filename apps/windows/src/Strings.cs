using System.Globalization;

namespace Ludion.Wallpaper;

/// <summary>
/// 画面の文。Windows の表示の言語が日本語なら日本語、ほかは英語（サイトと同じ2つ）。
/// 3つの違いを言葉でそろえる：「壁紙のオン／オフ」（オフで元の Windows の壁紙に戻る。アプリは残る）、
/// 「一時停止」（絵は残したまま動きと音を止める）、「Ludion を終わる」（アプリを閉じる。壁紙も元に戻る）。
/// </summary>
internal sealed record Strings(
    string Lang,
    string AppName,
    string TrayTitle,
    string Change,
    string WallpaperOn,
    string Pause,
    string Sound,
    string ForwardClicks,
    string PauseOnBattery,
    string StartWithWindows,
    string OpenSite,
    string Quit,
    string PickerTitle,
    string NoWebView)
{
    private static Strings? current;

    // 下の Japanese と English より後に決める（静的な値は書いた順に作られるため）
    public static Strings Current => current ??= For(CultureInfo.CurrentUICulture);

    public static Strings For(CultureInfo culture) => culture.TwoLetterISOLanguageName == "ja" ? Japanese : English;

    public static readonly Strings Japanese = new(
        Lang: "ja",
        AppName: "Ludion",
        TrayTitle: "Ludion の壁紙",
        Change: "壁紙を選ぶ…",
        WallpaperOn: "Ludion の壁紙：オン（オフで元の壁紙に戻る）",
        Pause: "一時停止（絵はそのまま、動きと音を止める）",
        Sound: "音を出す",
        ForwardClicks: "クリックを壁紙に渡す",
        PauseOnBattery: "電池のときは一時停止",
        StartWithWindows: "Windows の起動で始める",
        OpenSite: "ludion.ai を開く",
        Quit: "Ludion を終わる（壁紙も元に戻る）",
        PickerTitle: "壁紙を選ぶ — Ludion",
        NoWebView: "Microsoft Edge WebView2 ランタイムが見つかりません。Microsoft のページから入れてから、もう一度開いてください。");

    public static readonly Strings English = new(
        Lang: "en",
        AppName: "Ludion",
        TrayTitle: "Ludion wallpaper",
        Change: "Choose a wallpaper…",
        WallpaperOn: "Ludion wallpaper: on (off restores your wallpaper)",
        Pause: "Pause (keep the picture, stop motion and sound)",
        Sound: "Play sound",
        ForwardClicks: "Pass clicks to the wallpaper",
        PauseOnBattery: "Pause on battery",
        StartWithWindows: "Start with Windows",
        OpenSite: "Open ludion.ai",
        Quit: "Quit Ludion (restores your wallpaper)",
        PickerTitle: "Choose a wallpaper — Ludion",
        NoWebView: "Microsoft Edge WebView2 Runtime was not found. Install it from Microsoft, then open Ludion again.");
}
