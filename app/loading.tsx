/** 路由切换时的兜底 loading。各页面自己还有更细的加载态。 */
export default function Loading() {
  return (
    <div className="stack">
      <div className="loading">加载中…</div>
    </div>
  );
}
