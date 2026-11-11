using Ludion.Wallpaper;
using Xunit;

public class CommandTests
{
    [Fact]
    public void NoArgumentsIsLaunch() => Assert.Equal(Command.Kind.Launch, Command.FromArgs([]).What);

    [Fact]
    public void LaunchAsksTheRunningOneToShowTheList() =>
        Assert.Equal(Command.Kind.Show, Command.FromArgs([]).ForRunningInstance().What);

    [Fact]
    public void InstalledShowsTheList() => Assert.Equal(Command.Kind.Show, Command.FromArgs(["--installed"]).What);

    [Fact]
    public void StartupIsStartup() => Assert.Equal(Command.Kind.Startup, Command.FromArgs(["--startup"]).What);

    [Fact]
    public void ProtocolIsWall()
    {
        var command = Command.FromArgs(["ludion://wall/wallpaper-rain-window"]);
        Assert.Equal(Command.Kind.Wall, command.What);
        Assert.Equal("wallpaper-rain-window", command.WorkId);
    }

    [Fact]
    public void BadProtocolOnlyShowsTheList() => Assert.Equal(Command.Kind.Show, Command.FromArgs(["ludion://wall/../x"]).What);

    [Theory]
    [InlineData("show")]
    [InlineData("launch")]
    [InlineData("startup")]
    [InlineData("quit")]
    [InlineData("wall wallpaper-rain-window")]
    public void RoundTrips(string line) => Assert.Equal(line, Command.Parse(line)!.Serialize());

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("wall")]
    [InlineData("wall ../x")]
    [InlineData("wall a b")]
    [InlineData("open https://evil.example")]
    public void RejectsOtherLines(string? line) => Assert.Null(Command.Parse(line));
}

public class CatalogTests
{
    private static WorkJson Work(string? id, string? subtype, string? version = "1") =>
        new() { Id = id, Title = "T " + id, Subtype = subtype, Version = version, ThumbW = 1600, ThumbH = 900, Creator = new CreatorJson { Name = "Lattice", Kind = "person" } };

    [Fact]
    public void OnlyWallpapersWithGoodIds()
    {
        var response = new WorksResponse
        {
            Works =
            [
                Work("wallpaper-rain-window", "Wallpaper"),
                Work("toggle-daylight", "Toggle"),
                Work("../evil", "Wallpaper"),
                Work("no-version", "Wallpaper", version: null),
                Work(null, "Wallpaper"),
            ],
        };
        var item = Assert.Single(Catalog.Select(response, Links.Production));
        Assert.Equal("wallpaper-rain-window", item.Id);
        Assert.Equal("https://ludion.ai/w/wallpaper-rain-window/1/thumb.webp", item.Thumb);
        Assert.Equal("Lattice", item.Creator);
        Assert.False(item.Label);
    }

    [Fact]
    public void EmptyResponseIsEmpty() => Assert.Empty(Catalog.Select(null));
}
