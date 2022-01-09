
#include "pch.h"
#include "utils.h"

int _tmain(int argc, TCHAR* argv[])
{
   ENABLE_LOGGING(_T("log.txt"), _T("hook"));

   string cmdline = GetCommandLine();

   auto [queue, hook_queue, parent_session_id] = getQueueNames();
   if (queue.empty() || hook_queue.empty() || parent_session_id.empty()) {
      LOG("Exiting because of empty queue name");
      return 1;
   }

   json cfg;

   auto session_type = _T("cppvsdbg");
   makeConfig(cfg, session_type, cmdline, parent_session_id, hook_queue);

   if (!send(queue, cfg)) {
      return 1;
   }

   if (!await(hook_queue)) {
      return 1;
   }

   LOG("Success");
   return 0;
}
