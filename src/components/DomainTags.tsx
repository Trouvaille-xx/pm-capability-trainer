import { domainCode } from "@/lib/catalog";

/**
 * 领域标签。
 *
 * 领域信息以前散落在三处、每处长得都不一样（题头裸文字、记录页下划线、
 * 便签上干脆不显示），所以「产品设计 数据与分析」读起来只是一堆词。
 * 统一成一种形态：朱砂短竖线 + 编号 + 名称。
 *
 * 无领域时不渲染任何东西（返回 null），调用方不必自己判空。
 */
export function DomainTags({
  domains,
  className,
}: {
  domains: string[];
  className?: string;
}) {
  if (domains.length === 0) return null;

  return (
    <span className={`domains${className ? ` ${className}` : ""}`}>
      {domains.map((domain) => {
        const code = domainCode(domain);
        return (
          <span key={domain} className="domain">
            {code ? <span className="domain-code">{code}</span> : null}
            {domain}
          </span>
        );
      })}
    </span>
  );
}
