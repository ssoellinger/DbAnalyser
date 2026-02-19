using Microsoft.AspNetCore.SignalR;

namespace DbAnalyser.Api.Hubs;

public class AnalysisHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        await Clients.Caller.SendAsync("connected", Context.ConnectionId);
        await base.OnConnectedAsync();
    }
}
