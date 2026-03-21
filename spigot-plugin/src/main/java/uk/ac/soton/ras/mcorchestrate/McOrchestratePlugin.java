package uk.ac.soton.ras.mcorchestrate;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.plugin.java.JavaPlugin;

public final class McOrchestratePlugin extends JavaPlugin implements Listener {
    private static final String BOT_PREFIX = "bot:";
    private static final int MAX_RECENT_MESSAGES = 10;
    private HttpClient httpClient;
    private URI orchestratorUri;
    private final Map<UUID, Deque<String>> recentMessagesByPlayer = new HashMap<>();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        getConfig().addDefault("orchestrator.url", "http://127.0.0.1:7071/requests/chat-command");
        getConfig().options().copyDefaults(true);
        saveConfig();

        this.orchestratorUri = URI.create(getConfig().getString("orchestrator.url", "http://127.0.0.1:7071/requests/chat-command"));
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();
        Bukkit.getPluginManager().registerEvents(this, this);
        getLogger().info("MCOrchestrate plugin enabled.");
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAsyncPlayerChat(AsyncPlayerChatEvent event) {
        String message = event.getMessage();
        if (!message.toLowerCase().startsWith(BOT_PREFIX)) {
            return;
        }
        event.setCancelled(true);

        Player player = event.getPlayer();
        String trimmed = message.substring(BOT_PREFIX.length()).trim();
        Bukkit.getScheduler().runTask(this, () -> handleBotMessage(player, trimmed));
    }

    private void handleBotMessage(Player player, String message) {
        String requestId = UUID.randomUUID().toString();
        List<String> recentMessages = recentMessages(player);
        rememberMessage(player, message);
        String payload = JsonPayloadBuilder.buildRequestJson(requestId, player, message, recentMessages);
        HttpRequest request = HttpRequest.newBuilder(orchestratorUri)
            .timeout(Duration.ofSeconds(20))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(payload))
            .build();

        httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
            .thenAccept(response -> {
                JsonPayloadBuilder.ResponseSummary summary =
                    JsonPayloadBuilder.extractResponseSummary(response.body());
                Bukkit.getScheduler().runTask(this, () -> {
                    String reply = summary.reply();
                    // error is non-null only for HTTP-level failures (e.g. 400
                    // from Zod validation), not for orchestrator error responses
                    // which carry their message in the reply field.
                    String error = summary.error();
                    if (reply == null || reply.isBlank()) {
                        if (error != null && !error.isBlank()) {
                            player.sendMessage("[Bot] " + error);
                            return;
                        }
                        player.sendMessage("[Bot] I did not get a usable reply.");
                        return;
                    }

                    // For "executed" responses the bridge already sent a
                    // /say command that broadcasts to all players, so we
                    // skip a redundant private message here.
                    if (!"executed".equals(summary.status())) {
                        player.sendMessage("[Bot] " + reply);
                    }
                });
            })
            .exceptionally(error -> {
                Bukkit.getScheduler().runTask(this, () ->
                    player.sendMessage("[Bot] Local orchestrator error: " + error.getMessage())
                );
                return null;
            });
    }

    private List<String> recentMessages(Player player) {
        Deque<String> recent = recentMessagesByPlayer.get(player.getUniqueId());
        return recent == null ? List.of() : new ArrayList<>(recent);
    }

    private void rememberMessage(Player player, String message) {
        Deque<String> recent = recentMessagesByPlayer.computeIfAbsent(
            player.getUniqueId(),
            ignored -> new ArrayDeque<>()
        );
        recent.addLast(message);
        while (recent.size() > MAX_RECENT_MESSAGES) {
            recent.removeFirst();
        }
    }
}
