const fs = require('fs');
const logFile = "C:\\Users\\hajih\\.gemini\\antigravity\\brain\\c1498fbd-a533-408b-aaca-5085060cefa0\\.system_generated\\logs\\transcript_full.jsonl";
const lines = fs.readFileSync(logFile, 'utf-8').split('\n');
for (const line of lines) {
  if (!line) continue;
  try {
    const data = JSON.parse(line);
    if (data.type === 'PLANNER_RESPONSE' && data.tool_calls) {
      for (const tc of data.tool_calls) {
        if (['multi_replace_file_content', 'replace_file_content'].includes(tc.name)) {
          const args = tc.args || {};
          if (args.TargetFile && args.TargetFile.includes('SftpPanel.tsx')) {
            console.log('---');
            console.log(JSON.stringify(args, null, 2));
          }
        }
      }
    }
  } catch(e) {}
}
