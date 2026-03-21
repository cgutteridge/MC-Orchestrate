#!/usr/bin/env python3
import socket
import time
from datetime import datetime

# Connect to the server
client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
client.connect(('localhost', 7070))
print("connected to server!")

# Handle receiving data from the server
def receive_data():
    try:
        while True:
            data = client.recv(1024)
            if not data:
                break
    except Exception as e:
        print(f"Error receiving data: {e}")
    finally:
        print("disconnected from server")
        client.close()

# Function to send the block data
def set_block(x, y, z, block_type):
    command = f"setBlock {x} {y} {z} {block_type}\n"
    client.sendall(command.encode())

# Zero pad 2-digit numbers
def pad(n):
    return str(n).zfill(2)

# Function to convert string to picture-like format
def str_to_pic(string):
    template = """
0__ 1__ 2__ 3__ 4__ 5__ 6__ 7__ 8__ 9__ :__ X
###   # ### ### # # ### ### ### ### ###     X
# #   #   #   # # # #   #     # # # # #  #  X
# #   # ### ### ### ### ###   # ### ###     X
# #   # #     #   #   # # #   # # #   #  #  X
###   # ### ###   # ### ###   # ###   #     X
"""
    lines = template.strip().split('\n')
    index = {lines[0][i]: i for i in range(0, len(lines[0]), 4)}

    out_lines = [[' '] for _ in range(5)]
    for char in string:
        off = index.get(char, 0)
        for row in range(5):
            row_text = lines[row + 1]
            for col in range(4):
                out_lines[row].append(row_text[off + col])
    return out_lines

# Function to set picture blocks
def set_pic(x, y, z, pic):
    for yo, row in enumerate(pic):
        for xo, val in enumerate(row):
            if val == "#":
                set_block(x + xo, y + len(pic) - 1 - yo, z, "minecraft:lime_wool")
            elif val == " ":
                set_block(x + xo, y + len(pic) - 1 - yo, z, "minecraft:green_wool")

# Function to update the clock
def update_clock():
    while True:
        now = datetime.now()
        clock_str = f"{pad(now.hour)}:{pad(now.minute)}:{pad(now.second)}"
        pic = str_to_pic(clock_str)
        for line in pic:
            print("".join(line))
        print()
        set_pic(0, 150, 500, pic)
        time.sleep(1)

# Start the clock update loop
try:
    update_clock()
except KeyboardInterrupt:
    print("Clock stopped by user.")
    client.close()

