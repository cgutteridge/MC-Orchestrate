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
    private static final Pattern ERROR_PATTERN = Pattern.compile("\"error\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");

    private JsonPayloadBuilder() {
    }

    static String buildRequestJson(String requestId, Player player, String message, List<String> recentMessages) {
        StringBuilder json = new StringBuilder();
        json.append("{");
        appendField(json, "requestId", requestId).append(",");
        json.append("\"player\":").append(playerJson(player)).append(",");
        appendField(json, "message", message).append(",");
        json.append("\"recentMessages\":").append(stringArrayJson(recentMessages)).append(",");
        json.append("\"localContext\":").append(localContextJson(player)).append(",");
        json.append("\"serverContext\":").append(serverContextJson(player.getWorld())).append(",");
        json.append("\"initialScanRegion\":").append(initialScanRegionJson(player));
        json.append("}");
        return json.toString();
    }

    static ResponseSummary extractResponseSummary(String json) {
        return new ResponseSummary(
            extractJsonString(STATUS_PATTERN, json),
            extractJsonString(REPLY_PATTERN, json),
            extractJsonString(ERROR_PATTERN, json)
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

    /**
     * Returns the bounding box of the expanded block scan so the AI knows the
     * exact extent of the world data included in the initial payload.
     */
    private static String initialScanRegionJson(Player player) {
        Location origin = player.getLocation();
        int cx = origin.getBlockX();
        int cy = origin.getBlockY();
        int cz = origin.getBlockZ();
        StringBuilder json = new StringBuilder();
        json.append("{");
        json.append("\"minX\":").append(cx - SCAN_RADIUS_H).append(",");
        json.append("\"minY\":").append(cy - SCAN_RADIUS_DOWN).append(",");
        json.append("\"minZ\":").append(cz - SCAN_RADIUS_H).append(",");
        json.append("\"maxX\":").append(cx + SCAN_RADIUS_H).append(",");
        json.append("\"maxY\":").append(cy + SCAN_RADIUS_UP).append(",");
        json.append("\"maxZ\":").append(cz + SCAN_RADIUS_H);
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

    /** Half-width of the expanded horizontal block scan (inclusive). 15×15 = ±7. */
    private static final int SCAN_RADIUS_H = 7;
    /** Blocks to scan downward from the player's feet. */
    private static final int SCAN_RADIUS_DOWN = 2;
    /** Blocks to scan upward from the player's feet. */
    private static final int SCAN_RADIUS_UP = 5;
    /** Maximum non-air blocks returned to cap payload size. */
    private static final int SCAN_MAX_BLOCKS = 300;

    private static Block targetBlock(Player player) {
        RayTraceResult result = player.rayTraceBlocks(8.0);
        return result == null ? null : result.getHitBlock();
    }

    /**
     * Samples non-air blocks in a 15×8×15 region centred on the player.
     * Air blocks are skipped to keep payload size manageable. The list is
     * capped at {@value #SCAN_MAX_BLOCKS} entries processed in XZY order so
     * ground-level blocks are prioritised over high-altitude ones.
     */
    private static List<Block> sampleBlocks(Player player) {
        List<Block> blocks = new ArrayList<>();
        Location origin = player.getLocation();
        outer:
        for (int dx = -SCAN_RADIUS_H; dx <= SCAN_RADIUS_H; dx++) {
            for (int dz = -SCAN_RADIUS_H; dz <= SCAN_RADIUS_H; dz++) {
                for (int dy = -SCAN_RADIUS_DOWN; dy <= SCAN_RADIUS_UP; dy++) {
                    if (blocks.size() >= SCAN_MAX_BLOCKS) {
                        break outer;
                    }
                    Block block = origin.clone().add(dx, dy, dz).getBlock();
                    if (block.getType() != org.bukkit.Material.AIR
                            && block.getType() != org.bukkit.Material.CAVE_AIR
                            && block.getType() != org.bukkit.Material.VOID_AIR) {
                        blocks.add(block);
                    }
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

    private static String stringArrayJson(List<String> values) {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                json.append(",");
            }
            json.append("\"").append(escape(values.get(i))).append("\"");
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
        private final String error;

        ResponseSummary(String status, String reply, String error) {
            this.status = status;
            this.reply = reply;
            this.error = error;
        }

        String status() {
            return status;
        }

        String reply() {
            return reply;
        }

        String error() {
            return error;
        }
    }
}
