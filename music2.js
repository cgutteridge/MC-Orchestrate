// Adjust these to your server's settings
const host = 'localhost';
const port = 7070;

const net = require('node:net');
const client = net.createConnection({ host, port }, () => {
  console.log('Connected to Minecraft server!');
});

client.on('error', (err) => {
  console.error('Connection error:', err);
});

client.on('end', () => {
  console.log('Disconnected from server');
});

// Bach's Prelude in C Major opening motif (simplified)
const melody = [
  { note: 0 },  // C note
  { note: 2 },  // D note
  { note: 4 },  // E note
  { note: 5 },  // F note
  { note: 7 },  // G note
  { note: 9 },  // A note
  { note: 11 }, // B note
  { note: 12 }  // C note (one octave up)
];

// Starting position for the note blocks
const startX = 100;
const startY = 200; // Ground level; adjust as necessary
const startZ = 100;

melody.forEach((note, index) => {
  // Place note blocks in a line with a 1 block gap between each
  const x = startX + (index * 2);
  const y = startY;
  const z = startZ;

  // Construct the command to set a note block with the specific note
  const command = `setBlock ${x} ${y} ${z} minecraft:note_block[note=${note.note}]\n`;

  // Send command to the server with a delay to avoid overloading
  setTimeout(() => {
    client.write(command);
console.log( command)
  }, index * 10); // Adjust timing as needed
});

// Ensure the client closes after all commands are sent
setTimeout(() => {
  client.end();
}, melody.length * 500 + 1000);
