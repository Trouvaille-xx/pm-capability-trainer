const fs = require("fs");

const file = process.argv[2];
let text = fs.readFileSync(file, "utf8");

/** 把每一处冲突都替换成「HEAD 侧」的内容。 */
function keepOurs(input) {
  const OURS = "<<<<<<< HEAD";
  const SEP = "=======";
  const THEIRS = ">>>>>>> claude/quirky-wilson-3af267";
  let out = input;
  let count = 0;

  for (;;) {
    const a = out.indexOf(OURS);
    if (a === -1) break;
    const b = out.indexOf(SEP, a);
    const c = out.indexOf(THEIRS, b);
    if (b === -1 || c === -1) throw new Error("冲突结构异常");

    const ours = out.slice(a + OURS.length, b);
    // 顺手把 HEAD 侧首尾多余的空行收一收
    const trimmed = ours.replace(/^\r?\n/, "").replace(/\r?\n[ \t]*$/, "\n");
    out = out.slice(0, a) + trimmed + out.slice(c + THEIRS.length);
    count += 1;
  }
  return { out, count };
}

const { out, count } = keepOurs(text);
fs.writeFileSync(file, out);
console.log(`保留了 ${count} 处冲突的 HEAD 侧`);
