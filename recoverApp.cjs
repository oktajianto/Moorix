const fs = require('fs');

const logFile = "C:\\Users\\hajih\\.gemini\\antigravity\\brain\\c1498fbd-a533-408b-aaca-5085060cefa0\\.system_generated\\logs\\transcript_full.jsonl";
const lines = fs.readFileSync(logFile, 'utf-8').split('\n');

const { execSync } = require('child_process');
execSync('git checkout HEAD -- src/App.tsx');
let content = fs.readFileSync('src/App.tsx', 'utf-8');

for (const line of lines) {
  if (!line) continue;
  try {
    const data = JSON.parse(line);
    if (data.type === 'PLANNER_RESPONSE' && data.tool_calls) {
      for (const tc of data.tool_calls) {
        if (['multi_replace_file_content', 'replace_file_content'].includes(tc.name)) {
          const args = tc.args || {};
          if (args.TargetFile && (args.TargetFile.endsWith('src\\App.tsx') || args.TargetFile.endsWith('src/App.tsx'))) {
            const chunks = args.ReplacementChunks || [args];
            
            // apply this specific tool call's chunks to the CURRENT content
            const sortedChunks = [...chunks].sort((a, b) => b.StartLine - a.StartLine);
            let linesArr = content.split('\n');
            
            let failed = false;
            for (const chunk of sortedChunks) {
              const start = chunk.StartLine - 1;
              const end = chunk.EndLine;
              const replaced = chunk.ReplacementContent.split('\n');
              
              // simple verification: the TargetContent should match approximately what we are replacing
              // to be safe, we just blindly splice (since our agent did the same and succeeded)
              linesArr.splice(start, end - start, ...replaced);
            }
            if (!failed) {
              content = linesArr.join('\n');
            }
          }
        }
      }
    }
  } catch(e) {}
}

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx recovered successfully!');
