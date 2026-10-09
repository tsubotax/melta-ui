// 互換 shim: 本体は src/cli/lint-generated.ts（tsc で dist/cli/lint-generated.js に出し、npm に melta-lint bin として同梱）。
// npm run design:lint-generated・CI・tests/external-ds.spec.ts が旧パスを叩くので残す
import "../../src/cli/lint-generated.js";
