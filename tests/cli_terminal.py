"""Drive the compiled CLI through a real terminal, answering only visible prompts."""
import errno
import json
import os
import pty
import select
import subprocess
import sys
import time


def main(command, dialogue):
    master, terminal = pty.openpty()
    child = subprocess.Popen(command, stdin=terminal, stdout=terminal, stderr=terminal)
    os.close(terminal)
    output = bytearray()
    cursor = 0
    deadline = time.monotonic() + 20
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
                raise TimeoutError("CLI did not finish the expected dialogue")
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break  # End of the terminal on Linux.
            if not chunk:
                break
            output.extend(chunk)
            if dialogue:
                marker, answer = dialogue[0]
                end = output.find(marker.encode(), cursor)
                if end >= 0:
                    os.write(master, (answer + "\n").encode())
                    cursor = end + len(marker.encode())
                    dialogue.pop(0)
        if dialogue:
            raise RuntimeError("CLI exited before prompt: " + dialogue[0][0])
        return child.wait(timeout=2)
    finally:
        os.close(master)
        if child.poll() is None:
            child.kill()
            child.wait()
        stream = sys.stderr if sys.exc_info()[0] is not None or child.returncode else sys.stdout
        stream.buffer.write(output)


if __name__ == "__main__":
    sys.exit(main(sys.argv[2:], json.loads(sys.argv[1])))
