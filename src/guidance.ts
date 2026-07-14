/**
 * MCP 接続時にクライアントへ渡す、短い常駐ガイダンス。
 *
 * 詳細仕様を複製せず、DESIGN.md resource と既存 tools への導線だけを固定する。
 * vendor 先では serverName / uriScheme を差し替えて同じ engine を再利用できる。
 */
export function buildMcpInstructions(
  serverName = "melta-ui",
  uriScheme = "melta"
): string {
  return [
    `${serverName} は完成済み CSS コンポーネント集ではなく、contracts・rules・lint に基づいて UI を生成・検証するデザインシステムです。`,
    `UI 作業の前に ${uriScheme}://design-constitution（DESIGN.md）を読み、exact value は contracts を正としてください。競合時の優先順位は contracts > DESIGN.md Quick Reference > prose docs です。`,
    "必要な仕様は get_component、値は get_token、探索は search、文脈依存ルールは get_rules で確認してください。",
    "HTML / JSX / Vue を生成した後は必ず check_html で自己検証し、error を修正してから提示してください。violations が空でも manual rules とブランド品質は自動判定されません。",
    "check_html.passed は完成承認ではありません。結果は lint-clean draft / brand未承認として扱い、最終的なブランド・レイアウト・プロダクト適合は人間の確認に渡してください。",
  ].join("\n");
}

export const MCP_INSTRUCTIONS = buildMcpInstructions();
