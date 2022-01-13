
#include "pch.h"

static bool sClientConnected;

int _tmain(int argc, TCHAR* argv[])
{
   ENABLE_LOGGING(_T("log.txt"), _T("server"));

   if (!argv[1]) {
      LOG("No queue name provided, exiting");
      return 1;
   }

   string queue = argv[1];
   DWORD pipeMode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT;
   const size_t queue_bufsize = 10000;

   DWORD rlen = 0;

   if (argc >= 3) {
      auto buf = argv[2];
      const auto size = (DWORD)_tcslen(buf);
      HANDLE hPipe = CreateFile(queue.c_str(), GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
      if (hPipe == INVALID_HANDLE_VALUE) {
         LOG("Cannot open queue {}, exiting ({})", queue, getErrorMessage());
         return 1;
      }
      auto success = WriteFile(hPipe, buf, size, &rlen, nullptr);
      CloseHandle(hPipe);
      if (!success || !rlen) {
         if (GetLastError() == ERROR_BROKEN_PIPE) {
            LOG("Client disconnected");
         }
         else {
            LOG("WriteFile failed ({})", getErrorMessage());
         }
         return 1;
      }
      return 0;
   }

   while (true) {
      HANDLE hPipe = CreateNamedPipe(queue.c_str(), PIPE_ACCESS_DUPLEX, pipeMode, 100, queue_bufsize, queue_bufsize, NMPWAIT_USE_DEFAULT_WAIT, nullptr);
      if (hPipe == INVALID_HANDLE_VALUE) {
         LOG("Cannot create queue {}, exiting ({})", queue, getErrorMessage());
         return 1;
      }
      LOG("Queue created successfully: {}", queue);

      if (!ConnectNamedPipe(hPipe, NULL)) {
         LOG("Cannot connect queue {}, exiting ({})", queue, getErrorMessage());
         CloseHandle(hPipe);
      }
      else {
         static TCHAR buf[queue_bufsize];
         const auto size = std::size(buf) - sizeof(*buf);
         string data = _T("start|");
         while (true) {
            auto success = ReadFile(hPipe, buf, size, &rlen, nullptr);
            if (!success || !rlen) {
               if (GetLastError() == ERROR_BROKEN_PIPE) {
                  LOG("Client disconnected");
               }
               else {
                  LOG("ReadFile failed ({})", getErrorMessage());
               }
               break;
            }
            buf[rlen] = 0;
            LOG("Read from queue: {} {}", rlen, buf);
            if (string_view(buf) == _T("stop")) {
               LOG(_T("Stop message received"));
               CloseHandle(hPipe);
               return 0;
            }
            data += buf;
         }
         LOG("stdout: {}", data);
         data += _T("|end");
         printf("%s", data.c_str());
         fflush(stdout);
      }
   }
}
