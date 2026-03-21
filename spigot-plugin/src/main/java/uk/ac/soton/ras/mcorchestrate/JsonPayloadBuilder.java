package uk.ac.soton.ras.mcorchestrate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

final class JsonPayloadBuilder {
    private static final Pattern STATUS_PATTERN = Pattern.compile("\"status\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
    private static final Pattern REPLY_PATTERN = Pattern.compile("\"reply\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");

    private JsonPayloadBuilder() {
    }

    static String buildRequestJson(String requestId, Player player, String message) {
        StringBuilder json = new StringBuilder();
        json.append("{");
        appendField(json, "requestId", requestId).append(",");
        json.append("\"player\":").append(playerJson(player)).append(",");
        appendField(json, "message", message).append(",");
        json.append("\"localContext\":").append(localContextJson(player)).append(",");
        json.append("\"serverContext\":").append(serverContextJson(player.getWorld()));
        json.append("}");
        return json.toString();
    }

    static ResponseSummary extractResponseSummary(String json) {
        return new ResponseSummary(
            extractJsonString(STATUS_PATTERN, json),
            extractJsonString(REPLY_PATTERN, json)
        );
    }

    private static String extractJsonString(Pattern pattern, String json) {
        Matcher matcher = pattern.matcher(json);
        if (!matcher.find()) {
            return null;
        }
        return matcher.group(1)
            .replace("\\\"", "\"")
            .replace("\\n", "\n")
            .replace("\\\\", "\\");
    }

    private static String playerJson(Player player) {
        StringBuilder json = new StringBuilder();
        json.append("{");
        appendField(json, "uuid", player.getUniqueId().toString()).append(",");
        appendField(json, "name", player.getName()).append(",");
        appendField(json, "world", player.getWorld().getName()).append(",");
        json.append("\"position\":").append(vectorJson(player.getLocation())).append(",");
        json.append("\"yaw\":").append(player.getLocation().getYaw()).append(",");
        json.append("\"pitch\":").append(player.getLocation().getPitch()).append(",");
        json.append("\"lookVector\":").append(vectorJson(player.getLocation().getDirection()));
        json.append("}");
        return json.toString();
    }

    private static String localContextJson(Player player) {
        StringBuilder json = new StringBuilder();
        json.append("{");

        Block targetBlock = targetBlock(player);
        if (targetBlock != null) {
            json.append("\"targetBlock\":").append(blockJson(targetBlock)).append(",");
        }

        json.append("\"nearbyBlocks\":").append(blockArrayJson(sampleBlocks(player))).append(",");
        json.append("\"nearbyEntities\":").append(entityArrayJson(player.getNearbyEntities(8, 6, 8))).append(",");
        json.append("\"nearbyPlayers\":").append(playerArrayJson(player));
        json.append("}");
        return json.toString();
    }

    private static String serverContextJson(World world) {
        StringBuilder json = new StringBuilder();
        json.append("{");
        appendField(json, "timestamp", Instant.now().toString()).append(",");
        appendField(json, "dimension", world.getEnvironment().name()).append(",");
        json.append("\"onlinePlayerCount\":").append(Bukkit.getOnlinePlayers().size()).append(",");
        appendField(json, "motd", Bukkit.getMotd());
        json.append("}");
        return json.toString();
    }

    private static Block targetBlock(Player player) {
        RayTraceResult result = player.rayTraceBlocks(8.0);
        return result == null ? null : result.getHitBlock();
    }

    private static List<Block> sampleBlocks(Player player) {
        List<Block> blocks = new ArrayList<>();
        Location origin = player.getLocation();
        for (int dx = -2; dx <= 2; dx++) {
            for (int dy = -1; dy <= 2; dy++) {
                for (int dz = -2; dz <= 2; dz++) {
                    if (blocks.size() >= 40) {
                        return blocks;
                    }
                    blocks.add(origin.clone().add(dx, dy, dz).getBlock());
                }
            }
        }
        return blocks;
    }

    private static String blockArrayJson(List<Block> blocks) {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < blocks.size(); i++) {
            if (i > 0) {
                json.append(",");
            }
            json.append(blockJson(blocks.get(i)));
        }
        json.append("]");
        return json.toString();
    }

    private static String playerArrayJson(Player speaker) {
        StringBuilder json = new StringBuilder("[");
        int count = 0;
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getUniqueId().equals(speaker.getUniqueId())) {
                continue;
            }
            if (count > 0) {
                json.append(",");
            }
            json.append("{");
            appendField(json, "uuid", player.getUniqueId().toString()).append(",");
            appendField(json, "name", player.getName()).append(",");
            appendField(json, "world", player.getWorld().getName()).append(",");
            json.append("\"position\":").append(vectorJson(player.getLocation()));
            json.append("}");
            count++;
        }
        json.append("]");
        return json.toString();
    }

    private static String entityArrayJson(Collection<Entity> entities) {
        StringBuilder json = new StringBuilder("[");
        int index = 0;
        for (Entity entity : entities) {
            if (index > 0) {
                json.append(",");
            }
            json.append("{");
            appendField(json, "name", entity.getName()).append(",");
            appendField(json, "type", entity.getType().name()).append(",");
            json.append("\"position\":").append(vectorJson(entity.getLocation()));
            json.append("}");
            index++;
        }
        json.append("]");
        return json.toString();
    }

    private static String blockJson(Block block) {
        StringBuilder json = new StringBuilder();
        json.append("{");
        json.append("\"x\":").append(block.getX()).append(",");
        json.append("\"y\":").append(block.getY()).append(",");
        json.append("\"z\":").append(block.getZ()).append(",");
        appendField(json, "type", materialKey(block.getType()));
        json.append("}");
        return json.toString();
    }

    private static StringBuilder appendField(StringBuilder json, String key, String value) {
        json.append("\"").append(escape(key)).append("\":\"").append(escape(value)).append("\"");
        return json;
    }

    private static String vectorJson(Location location) {
        return "{\"x\":" + location.getX() + ",\"y\":" + location.getY() + ",\"z\":" + location.getZ() + "}";
    }

    private static String vectorJson(Vector vector) {
        return "{\"x\":" + vector.getX() + ",\"y\":" + vector.getY() + ",\"z\":" + vector.getZ() + "}";
    }

    private static String materialKey(org.bukkit.Material material) {
        return "minecraft:" + material.getKey().getKey();
    }

    private static String escape(String text) {
        return text
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "");
    }

    static final class ResponseSummary {
        private final String status;
        private final String reply;

        ResponseSummary(String status, String reply) {
            this.status = status;
            this.reply = reply;
        }

        String status() {
            return status;
        }

        String reply() {
            return reply;
        }
    }
}
