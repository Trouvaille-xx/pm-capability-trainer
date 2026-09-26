/* ==========================================================================
   线索板 · 共享脚本
   --------------------------------------------------------------------------
   从 07-board.html 抽出来的通用逻辑，供 08/09/10/11 四个页面复用。

   提供：
   - tiltPool / assignTilts  便签角度（互不重复、按 id 固定）
   - initBoard(notes, opts)  便签墙 + 详情 + 翻页 + 视图切换 + 键盘
   - initRail()              侧栏折叠/展开
   - toast / loc             轻提示与跳转

   initBoard 的 opts：
     emptyHtml  空态 HTML（可选）
     onOpen     接管「点便签」的行为，签名 (note, id)
                —— 10-trainer 用它进入完整会话界面，不走通用详情
   ========================================================================== */

(function (global) {
  "use strict";

  /* ============================================================
     便签角度
     ------------------------------------------------------------
     要求：每个条目的角度都不一样（不能撞），且同一条目每次都是同一角度。
     做法：生成一批互不相同的候选角度，再按 id 哈希排序分配。
     ============================================================ */
  var TILT_MIN = 3.5; // 太小的角度看起来像渲染错误，避开
  var TILT_MAX = 15;

  function tiltPool(n) {
    var out = [];
    var span = TILT_MAX - TILT_MIN;
    var steps = Math.max(1, Math.floor((n - 1) / 2));
    for (var i = 0; i < n; i++) {
      var sign = i % 2 === 0 ? 1 : -1;
      var rank = Math.floor(i / 2);
      out.push(sign * (TILT_MIN + (span * rank) / steps));
    }
    return out.map(function (v) {
      return Math.round(v * 10) / 10;
    });
  }

  function hashId(id) {
    var h = 2166136261;
    for (var i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function assignTilts(items) {
    var n = items.length;
    if (!n) return {};
    var pool = tiltPool(n);
    var order = items
      .map(function (it, i) {
        return { i: i, key: hashId(it.id) };
      })
      .sort(function (a, b) {
        return a.key - b.key;
      })
      .map(function (o) {
        return o.i;
      });

    var map = {};
    order.forEach(function (itemIndex, rank) {
      map[items[itemIndex].id] = pool[rank];
    });
    return map;
  }

  /* ============================================================
     工具
     ============================================================ */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.innerHTML = '<span class="mk">●</span><span>' + esc(msg) + "</span>";
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 1900);
  }

  function loc(href) {
    location.href = href;
  }

  /* ============================================================
     主渲染
     ============================================================ */
  function initBoard(items, opts) {
    opts = opts || {};
    var TILTS = assignTilts(items);

    var wall = document.getElementById("wall");
    if (!wall) return;

    var reader = document.getElementById("reader");
    var rcard = document.getElementById("rcard");
    var dots = document.getElementById("dots");
    var pnum = document.getElementById("pnum");
    var backbar = document.getElementById("backbar");
    var prev = document.getElementById("prev");
    var next = document.getElementById("next");
    var q = document.getElementById("q");
    var qhint = document.getElementById("qhint");

    var view = "card";
    var keyword = "";
    var activeFilter = "全部";
    var readerIndex = 0;

    /* ---- 筛选 ---- */
    function visible() {
      return items.filter(function (it) {
        if (activeFilter !== "全部") {
          var hay = (it.category || it.eyebrow || "") + (it.title || "");
          if (hay.indexOf(activeFilter) === -1) return false;
        }
        if (keyword) {
          var k = keyword.toLowerCase();
          var blob = [it.title, it.lead, it.detail, it.eyebrow, it.category, (it.tags || []).join(" ")]
            .join(" ")
            .toLowerCase();
          if (blob.indexOf(k) === -1) return false;
        }
        return true;
      });
    }

    /* ---- 便签墙 ---- */
    function renderWall() {
      var list = visible();
      if (!list.length) {
        wall.innerHTML =
          opts.emptyHtml ||
          '<div class="empty-board"><h3>没有匹配的便签</h3><p>换个关键词，或者清掉筛选。</p></div>';
        updateHint(0);
        return;
      }

      wall.innerHTML = list
        .map(function (it) {
          var extra = "";

          // 关键要点清单（记录总结用）
          if (it.points && it.points.length) {
            extra +=
              '<ul class="note-points">' +
              it.points
                .slice(0, 3)
                .map(function (p) {
                  return "<li>" + esc(p) + "</li>";
                })
                .join("") +
              "</ul>";
          }

          // 星级（记录总结用）
          if (it.rating) {
            var stars = "";
            for (var i = 1; i <= 5; i++) {
              stars += i <= it.rating ? "<b>★</b>" : "☆";
            }
            extra += '<div class="stars" style="margin-top:10px">' + stars + "</div>";
          }

          // 标签
          if (it.tags && it.tags.length) {
            extra +=
              '<div class="note-tags">' +
              it.tags
                .slice(0, 4)
                .map(function (t) {
                  return "<span>" + esc(t) + "</span>";
                })
                .join("") +
              "</div>";
          }

          // 大数字（训练报告用）
          if (it.score != null) {
            extra +=
              '<div class="note-score">' +
              esc(it.score) +
              (it.scoreMax ? "<small>/ " + esc(it.scoreMax) + "</small>" : "") +
              "</div>";
          }

          // 底部左侧标记
          var flagHtml = "";
          if (it.foot) {
            var cls = it.footFlag ? " " + it.footFlag : "";
            flagHtml = '<span class="flag' + cls + '">' + esc(it.foot) + "</span>";
          }

          // 头行：类目 + 状态（两个独立元素，不是「·」拼接的字符串）
          var headRow = "";
          if (it.eyebrow || it.state) {
            headRow =
              '<div class="note-domain">' +
              (it.eyebrow ? "<span>" + esc(it.eyebrow) + "</span>" : "") +
              '<span class="state-mark">' + esc(it.state || "") + "</span>" +
              "</div>";
          }

          return (
            '<article class="note' +
            (it.flagged ? " flagged" : "") +
            '" style="--tilt:' +
            (TILTS[it.id] || 0) +
            'deg" tabindex="0" data-id="' +
            esc(it.id) +
            '">' +
            '<span class="pin"></span>' +
            headRow +
            '<div class="note-head"><h2 class="note-title">' +
            esc(it.title) +
            "</h2></div>" +
            (it.lead ? '<p class="note-def">' + esc(it.lead) + "</p>" : "") +
            (it.detail ? '<p class="note-detail">' + esc(it.detail) + "</p>" : "") +
            extra +
            '<div class="note-foot">' +
            flagHtml +
            '<span class="more">打开</span>' +
            "</div>" +
            "</article>"
          );
        })
        .join("");

      updateHint(list.length);
    }

    function updateHint(n) {
      if (!qhint) return;
      qhint.textContent =
        n === items.length ? items.length + " 张中检索" : "显示 " + n + " / " + items.length;
    }

    /* ---- 点便签 ---- */
    function byId(id) {
      return items.filter(function (x) {
        return x.id === id;
      })[0];
    }

    wall.addEventListener("click", function (e) {
      var note = e.target && e.target.closest ? e.target.closest(".note") : null;
      if (!note) return;
      if (typeof opts.onOpen === "function") {
        opts.onOpen(byId(note.dataset.id), note.dataset.id);
        return;
      }
      openEntry(note.dataset.id);
    });
    wall.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var note = e.target && e.target.closest ? e.target.closest(".note") : null;
      if (!note) return;
      e.preventDefault();
      if (typeof opts.onOpen === "function") {
        opts.onOpen(byId(note.dataset.id), note.dataset.id);
        return;
      }
      openEntry(note.dataset.id);
    });

    function openEntry(id) {
      var list = visible();
      var pos = list.findIndex(function (x) {
        return x.id === id;
      });
      readerIndex = pos < 0 ? 0 : pos;
      setView("reader", true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    /* ---- 详情 ---- */
    function renderReader() {
      if (!rcard) return; // 页面用自己的详情结构时跳过
      var list = visible();

      if (!list.length) {
        rcard.innerHTML =
          '<div style="padding:40px 0;color:var(--ink-4);text-align:center;font-style:italic">没有可显示的条目。</div>';
        if (dots) dots.innerHTML = "";
        if (pnum) pnum.textContent = "0 / 0";
        if (prev) prev.disabled = true;
        if (next) next.disabled = true;
        return;
      }

      readerIndex = Math.max(0, Math.min(readerIndex, list.length - 1));
      var it = list[readerIndex];

      var html = '<span class="pin"></span>';

      html +=
        '<div class="reader-domain">' +
        esc(it.eyebrow || "") +
        (it.state ? '<span class="state-mark">' + esc(it.state) + "</span>" : "") +
        "</div>";
      html += '<h2 class="reader-title">' + esc(it.title) + "</h2>";
      if (it.lead) html += '<p class="reader-def">' + esc(it.lead) + "</p>";

      // 对话型（训练记录）：详情里渲染 transcript
      if (it.turns && it.turns.length) {
        html +=
          '<div class="turns">' +
          it.turns
            .map(function (t) {
              var tools = "";
              if (t.tools && t.tools.length) {
                tools =
                  '<div class="turn-tools">' +
                  t.tools
                    .map(function (tl) {
                      return (
                        '<div class="turn-tool"><span class="st">✓</span><span>' +
                        esc(tl.name) +
                        "</span><span>" +
                        esc(tl.detail) +
                        "</span></div>"
                      );
                    })
                    .join("") +
                  "</div>";
              }
              return (
                '<div class="turn-' +
                (t.role === "user" ? "user" : "ai") +
                '">' +
                '<div class="turn-role">' +
                (t.role === "user" ? "我" : "训练师") +
                "</div>" +
                '<div class="turn-body">' +
                esc(t.content).replace(/\n/g, "<br>") +
                "</div>" +
                tools +
                "</div>"
              );
            })
            .join("") +
          "</div>";
      } else if (it.detail) {
        html += '<p class="reader-detail">' + esc(it.detail) + "</p>";
      }

      if (it.points && it.points.length) {
        html +=
          '<div class="reader-sec"><span class="reader-sec-label">关键要点</span>' +
          '<ul class="note-points" style="font-size:14.5px">' +
          it.points
            .map(function (p) {
              return "<li>" + esc(p) + "</li>";
            })
            .join("") +
          "</ul></div>";
      }

      if (it.thoughts) {
        html +=
          '<div class="reader-sec"><span class="reader-sec-label">我的思考</span>' +
          '<p class="reader-sec-body">' +
          esc(it.thoughts) +
          "</p></div>";
      }

      if (it.example) {
        html +=
          '<div class="reader-sec"><span class="reader-sec-label">例子</span>' +
          '<p class="reader-example">' +
          esc(it.example) +
          "</p></div>";
      }

      if (it.meta && it.meta.length) {
        html +=
          '<div class="reader-sec"><span class="reader-sec-label">信息</span>' +
          it.meta
            .map(function (m) {
              return (
                '<div style="display:flex;gap:14px;padding:5px 0;font-size:14px">' +
                '<span style="font-size:12px;color:var(--ink-4);width:74px;flex:none;padding-top:3px">' +
                esc(m[0]) +
                "</span><span style=\"color:var(--ink-2)\">" +
                esc(m[1]) +
                "</span></div>"
              );
            })
            .join("") +
          "</div>";
      }

      if (it.howToUse) {
        html +=
          '<div class="reader-sec"><span class="reader-sec-label">怎么用</span>' +
          '<p class="reader-sec-body">' +
          esc(it.howToUse) +
          "</p></div>";
      }

      if (it.actions && it.actions.length) {
        html +=
          '<div class="reader-actions">' +
          it.actions
            .map(function (a, i) {
              return (
                '<button class="' +
                (a.go ? "go" : "") +
                '" data-action="' +
                i +
                '">' +
                esc(a.t) +
                "</button>"
              );
            })
            .join("") +
          "</div>";
      }

      rcard.innerHTML = html;

      rcard.querySelectorAll("[data-action]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var a = it.actions[+btn.dataset.action];
          if (a && a.href) loc(a.href);
          else toast(a ? a.t : "");
        });
      });

      if (dots) {
        dots.innerHTML = list
          .map(function (_, i) {
            return '<i class="' + (i === readerIndex ? "on" : "") + '" data-i="' + i + '"></i>';
          })
          .join("");
      }
      if (pnum) pnum.textContent = readerIndex + 1 + " / " + list.length;
      if (prev) prev.disabled = readerIndex === 0;
      if (next) next.disabled = readerIndex === list.length - 1;
    }

    if (dots) {
      dots.addEventListener("click", function (e) {
        var i = e.target && e.target.closest ? e.target.closest("i") : null;
        if (!i) return;
        readerIndex = +i.dataset.i;
        renderReader();
      });
    }

    function step(d) {
      var list = visible();
      var n = readerIndex + d;
      if (n < 0 || n >= list.length) return;
      readerIndex = n;
      if (rcard) {
        rcard.style.animation = "none";
        void rcard.offsetWidth;
        rcard.style.animation = "";
      }
      renderReader();
    }
    if (prev) prev.addEventListener("click", function () { step(-1); });
    if (next) next.addEventListener("click", function () { step(1); });

    /* ---- 视图切换 ---- */
    function setView(v, fromNote) {
      view = v;
      var vsCard = document.getElementById("vs-card");
      var vsReader = document.getElementById("vs-reader");
      var board = document.getElementById("boardEl") || document.querySelector(".board");
      if (vsCard) vsCard.classList.toggle("on", v === "card");
      if (vsReader) vsReader.classList.toggle("on", v === "reader");
      if (board) board.style.display = v === "card" ? "" : "none";
      if (reader) reader.classList.toggle("on", v === "reader");
      if (backbar) backbar.style.display = v === "reader" && fromNote ? "flex" : "none";
      if (v === "reader") renderReader();
    }

    /* ---- 筛选按钮 ---- */
    var filtersEl = document.getElementById("filters");
    if (filtersEl) {
      filtersEl.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("button[data-f]") : null;
        if (!b) return;
        activeFilter = b.dataset.f;
        filtersEl.querySelectorAll("button").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
        renderWall();
        if (view === "reader") renderReader();
      });
    }

    /* ---- 检索 ---- */
    var qt;
    if (q) {
      q.addEventListener("input", function () {
        clearTimeout(qt);
        qt = setTimeout(function () {
          keyword = q.value.trim();
          renderWall();
          if (view === "reader") renderReader();
        }, 130);
      });
    }

    /* ---- 键盘 ---- */
    // e.target 可能是 document / body（没有 .closest），所以要防御
    function inField(e) {
      var t = e.target;
      if (!t || typeof t.closest !== "function") return false;
      return !!t.closest("input,textarea,select");
    }

    document.addEventListener("keydown", function (e) {
      var inInput = q && document.activeElement === q;

      // ? 切换快捷键提示（右下角那条）
      if (e.key === "?" && !inInput && !inField(e)) {
        e.preventDefault();
        var hb = document.querySelector(".hintbar");
        if (hb) hb.classList.toggle("show");
        return;
      }
      if (e.key === "Escape") {
        var hb2 = document.querySelector(".hintbar");
        if (hb2 && hb2.classList.contains("show")) {
          hb2.classList.remove("show");
          return;
        }
      }

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        if (q) { q.focus(); q.select(); }
        return;
      }
      if (e.key === "Escape" && inInput) {
        q.value = "";
        keyword = "";
        renderWall();
        if (view === "reader") renderReader();
        q.blur();
        return;
      }
      if (inInput) return;

      if (e.key === " " && !inField(e) && document.getElementById("vs-reader")) {
        e.preventDefault();
        setView(view === "card" ? "reader" : "card");
        return;
      }
      if (view === "reader") {
        if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      }
    });

    /* ---- 暴露给页面 ---- */
    global.setView = setView;
    global.step = step;
    global.boardToast = toast;
    global.boardLoc = loc;

    renderWall();
    renderReader();
  }

  /* ============================================================
     侧栏：折叠 / 展开
     ------------------------------------------------------------
     折叠 68px  —— 只有朱砂标记和卡边，零文字
     展开 200px —— 完整标签，内容区同步向右让位

     注意：不能做成浮层盖在内容上 —— 那会直接遮住便签。
     侧栏宽度和 body 左内边距用同一条 transition，两者同步移动。
     状态存在 localStorage，刷新后保持；也响应键盘 [ 键
     ============================================================ */
  function initRail() {
    var rail = document.querySelector(".rail");
    if (!rail) return;
    var btn = rail.querySelector(".rail-toggle");
    var KEY = "pm-rail-open";

    function apply(open, animate) {
      if (!animate) {
        rail.style.transition = "none";
        document.body.style.transition = "none";
      }
      rail.classList.toggle("open", open);
      document.body.classList.toggle("rail-open", open);
      if (btn) {
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.title = open ? "收起侧栏（[）" : "展开侧栏（[）";
      }
      if (!animate) {
        void rail.offsetWidth;
        rail.style.transition = "";
        document.body.style.transition = "";
      }
    }

    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    apply(saved === "1", false);

    function toggle() {
      var open = !rail.classList.contains("open");
      apply(open, true);
      try { localStorage.setItem(KEY, open ? "1" : "0"); } catch (e) {}
    }

    if (btn) btn.addEventListener("click", toggle);

    document.addEventListener("keydown", function (e) {
      var t = e.target;
      var inField = t && typeof t.closest === "function" && t.closest("input,textarea,select");
      if (e.key === "[" && !inField) {
        e.preventDefault();
        toggle();
      }
    });
  }

  global.assignTilts = assignTilts;
  global.tiltPool = tiltPool;
  global.initBoard = initBoard;
  global.initRail = initRail;
  global.boardToast = toast;
  global.boardLoc = loc;
})(window);
