import os
import select
import socket
import socketserver
import sys
import threading

import paramiko


class ForwardServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(socketserver.BaseRequestHandler):
    chain_host = None
    chain_port = None
    ssh_transport = None

    def handle(self):
      try:
          channel = self.ssh_transport.open_channel(
              "direct-tcpip",
              (self.chain_host, self.chain_port),
              self.request.getpeername(),
          )
      except Exception as exc:
          print(f"open_channel failed: {exc}", file=sys.stderr, flush=True)
          return

      if channel is None:
          print("open_channel returned none", file=sys.stderr, flush=True)
          return

      while True:
          readable, _, _ = select.select([self.request, channel], [], [])
          if self.request in readable:
              data = self.request.recv(16384)
              if len(data) == 0:
                  break
              channel.send(data)
          if channel in readable:
              data = channel.recv(16384)
              if len(data) == 0:
                  break
              self.request.send(data)

      channel.close()
      self.request.close()


def main():
    local_host = os.environ.get("TUNNEL_LOCAL_HOST", "127.0.0.1")
    local_port = int(os.environ["TUNNEL_LOCAL_PORT"])
    remote_host = os.environ.get("TUNNEL_REMOTE_HOST", "127.0.0.1")
    remote_port = int(os.environ["TUNNEL_REMOTE_PORT"])
    ssh_host = os.environ["TUNNEL_SSH_HOST"]
    ssh_port = int(os.environ.get("TUNNEL_SSH_PORT", "22"))
    ssh_user = os.environ["TUNNEL_SSH_USER"]
    ssh_password = os.environ.get("TUNNEL_SSH_PASSWORD")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        ssh_host,
        port=ssh_port,
        username=ssh_user,
        password=ssh_password,
        look_for_keys=True,
        allow_agent=True,
        timeout=15,
    )

    handler = Handler
    handler.chain_host = remote_host
    handler.chain_port = remote_port
    handler.ssh_transport = client.get_transport()

    server = ForwardServer((local_host, local_port), handler)
    print(
        f"tunnel {local_host}:{local_port} -> {ssh_user}@{ssh_host}:{remote_host}:{remote_port}",
        flush=True,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    thread.join()


if __name__ == "__main__":
    main()
