#!/usr/bin/node
const net = require('node:net');
const client = net.createConnection({ port: 7070 }, () => {
  console.log('connected to server!');
});

client.on('data', (data) => {
  // Handle data from the server, if necessary
});

client.on('end', () => {
  console.log('disconnected from server');
  process.exit(0);
});

// Call drawPig function once the connection is established
client.on('connect', () => {
  drawPig(0, 200, 100);
});

function drawPig(x, y, z) {
  const pigDesign = [
    "     PPPPP      ",
    "    PPPPPPP     ",
    "   PPPPPPPPP    ",
    "  PPPPPPPPPPP   ",
    " PPPPPPPPPPPPP  ",
    " PPPPPBBBBBPPPP ",
    " PPPB     BP PPP",
    "PPPPB     BP PPP",
    "PPPP       PPPPP",
    " PPPP     PPPPP ",
    "  PPPPPPPPPPPP  ",
    "   PPPPPPPPPP   "
  ];

  pigDesign.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const blockType = getBlockType(line[col]);
      if (blockType) {
        setBlock(x + col, y + pigDesign.length - 1 - row, z, blockType);
      }
    }
  });
}

function getBlockType(char) {
  switch (char) {
    case 'P': return "minecraft:pink_wool";
    case 'B': return "minecraft:black_wool";
    default: return null; // No block for spaces or unrecognized characters
  }
}

function setBlock(x, y, z, type) {
  client.write(`setBlock ${x} ${y} ${z} ${type}\n`);
}
