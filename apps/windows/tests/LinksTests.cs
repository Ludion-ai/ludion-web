using Ludion.Wallpaper;
using Xunit;

public class LinksTests
{
    [Theory]
    [InlineData("ludion://wall/wallpaper-rain-window", "wallpaper-rain-window")]
    [InlineData("ludion://wall/wallpaper-rain-window/", "wallpaper-rain-window")]
    [InlineData("ludion://wall/a1", "a1")]
    public void ProtocolGivesTheWorkId(string argument, string expected) =>
        Assert.Equal(expected, Links.ParseProtocol(argument));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ludion://wall/")]
    [InlineData("ludion://wall/../../evil")]
    [InlineData("ludion://wall/a/b")]
    [InlineData("ludion://wall/a?x=1")]
    [InlineData("ludion://wall/a#x")]
    [InlineData("ludion://wall/-a")]
    [InlineData("ludion://wall/a--b")]
    [InlineData("ludion://wall/A")]
    [InlineData("ludion://wall/a%2Fb")]
    [InlineData("ludion://user@wall/a")]
    [InlineData("ludion://wall:80/a")]
    [InlineData("ludion://open/a")]
    [InlineData("https://ludion.ai/p/a/wall")]
    [InlineData("--startup")]
    public void ProtocolRejectsOtherShapes(string? argument) => Assert.Null(Links.ParseProtocol(argument));

    [Fact]
    public void ProtocolRejectsLongIds() => Assert.Null(Links.ParseProtocol("ludion://wall/" + new string('a', 65)));

    [Fact]
    public void WallIsTheFullScreenAddress() =>
        Assert.Equal("https://ludion.ai/p/wallpaper-rain-window/wall", Links.Wall("wallpaper-rain-window", Links.Production).AbsoluteUri);

    [Theory]
    [InlineData(null, "https://ludion.ai")]
    [InlineData("", "https://ludion.ai")]
    [InlineData("http://localhost:5199", "http://localhost:5199")]
    [InlineData("http://127.0.0.1:8787/", "http://127.0.0.1:8787")]
    [InlineData("https://evil.example", "https://ludion.ai")]
    [InlineData("http://localhost.evil.example", "https://ludion.ai")]
    [InlineData("http://localhost:5199/p/x", "https://ludion.ai")]
    [InlineData("file:///C:/x", "https://ludion.ai")]
    public void OriginIsLudionUnlessLocal(string? value, string expected) => Assert.Equal(expected, Links.ResolveOrigin(value));

    [Theory]
    [InlineData("https://ludion.ai/p/a/wall", true)]
    [InlineData("https://ludion.ai/p/a/wall?x=1", true)]
    [InlineData("https://ludion.ai/p/b/wall", false)]
    [InlineData("https://ludion.ai/p/a", false)]
    [InlineData("https://ludion.ai/frame/a/1/wall.html", false)]
    [InlineData("http://ludion.ai/p/a/wall", false)]
    [InlineData("https://evil.example/p/a/wall", false)]
    [InlineData("https://ludion.ai.evil.example/p/a/wall", false)]
    [InlineData("javascript:alert(1)", false)]
    public void WallWindowStaysOnItsAddress(string target, bool allowed) =>
        Assert.Equal(allowed, Links.IsAllowedWallNavigation(target, "a", Links.Production));

    [Fact]
    public void ThumbIsOnTheSite() =>
        Assert.Equal("https://ludion.ai/w/a/3/thumb.webp", Links.Thumb("a", "3", Links.Production));
}
