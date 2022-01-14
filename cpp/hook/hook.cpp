
#include "pch.h"
#include "utils.h"

int _tmain(int argc, TCHAR* argv[])
{
   ENABLE_LOGGING(_T("log.txt"), _T("hook"));

   string cmdline = GetCommandLine();

   cConfig config(_T(""), argc, argv);

   if (!config.send()) {
      return -1;
   };

   LOG("Success");
   return 0;
}
