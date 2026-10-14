# Content

<!-- repository-creator:managed:start -->

## Role

サービスが価値として何を提供し、その中身をどこまで充実させるかを扱う。教材、記事、レシピ、商品・施設情報、課題、シナリオ、テンプレート、事例、ヘルプなどのプロダクト固有コンテンツと、必要なユーザー向け文言を対象とする。機能は `FEATURES.md`、見せ方は `DESIGN.md` の責務とする。

## Goal

初回は中心価値を実際に評価できるコアコンテンツへ集中する。コア完成後は、完成した実物を基準に不足を評価し、カバー範囲、深さ、構造、形式、品質をまとめて拡充してプロダクトとして十分な内容へ育てる。大量の薄い内容を最初から作ることも、一種類ずつ細切れに増やすことも目的にしない。

## Core Establishment

- 対象ユーザー、利用目的、中心価値を確認し、価値と品質基準を評価できるコアコンテンツ群を定める。
- 量を増やす前に、コンテンツの型、分類、粒度、根拠、文体、品質基準を確立する。
- 仮テキストや薄い大量生成で完成したように見せず、少量でも実際に利用できる内容を作る。
- コア体験に必要な例、説明、初期データ、案内をコアコンテンツとして完成させる。

## Product Expansion

- コア完成後に、対象ユーザーと利用目的に対するカバー範囲、深さ、難易度、形式、カテゴリ間の偏り、コンテンツ同士のつながりを改めて評価する。
- 必要なら類似・隣接サービスと信頼できる情報源を調査し、重大な欠落、薄い領域、重複、古い情報を洗い出す。
- コンテンツ候補を列挙し、ユーザー価値、中心体験との接続、品質、根拠、更新可能性、維持負担で `採用`、`保留`、`見送り` に分ける。
- 次に目指す完成状態を定め、採用したコンテンツ群を一つの `Expansion Set` として選ぶ。
- `Expansion Set` を一カテゴリや一形式へ限定しない。AIが一度に品質、一貫性、根拠を維持して作成・統合・検証でき、次の完成状態へ意味のある進歩を作れる範囲を基準にする。
- 量だけでなく、発見しやすさ、順序、関連付け、メタデータ、更新可能性まで一つの体系として完成させる。
- 実装後は内容の品質と利用フローへの接続を検証し、プロダクト全体を再評価する。次に採用すべき重要な候補があれば反復する。

## Workflow Handoff

この領域の `Expansion Set` を実装・検証したことは、プロダクト全体の作業完了を意味しない。

- コンテンツ領域で採用した改善の実装と確認が終わったら、必ず `WORKFLOW.md` のプロダクト全体再評価へ戻る。
- この文書単独ではタスクの最終完了を判断しない。
- コンテンツ改善を一周したこと、必要な教材や内容を追加したこと、現在の `Expansion Set` を完了したことを理由に作業を終了してはならない。
- `WORKFLOW.md` の全体再評価で新たに1件以上の改善が `採用` された場合、タスクは未完了であり、そのまま次の実装・検証・再評価へ進む。
- 最終的な継続・終了判定は `WORKFLOW.md` の終了条件に従う。

## Quality and Records

- 対象言語で自然かつ具体的に書き、ユーザーが認識する言葉と一貫した用語を使う。
- 事実、数値、効能、比較、法的表現は根拠を確認し、確認できない内容を作らない。
- genericな宣伝文句、過剰な形容、不要な説明、AIらしい均質なコピーをデフォルト採用しない。
- 個別原稿や更新履歴を蓄積せず、現在の成熟度、コアの完了条件、次の完成状態、現在の `Expansion Set`、品質基準、長く維持すべき判断だけを下に残す。

<!-- repository-creator:managed:end -->

## Project Content Maturity

- Core content: モデル・色の選択、描画/消去/視点の操作案内、型紙の寸法、印刷の注意、状態/失敗表示。iPhone/iPadは「写真に保存」→「画像を保存」を案内。未対応は実画像の長押し保存。共有完了を写真ライブラリへの保存確認とは表記しない。
- Quality: 日本語の短い操作説明。性別/左右/部位と型紙タイトル・端部名を一致させる。540/800/500mmは参考モデル値で人体平均とは表記しない。表示用の手・足・胸腹・首元を区別する。
- Asset: Blender Studio Human Base Meshes v1.4.1 の Body Male/Female - Realisticを採用。作者Dan Ulrich、CC0。Multiresolution level2のscan surfaceから実際の左右腕・左右脚と両肩を含むトルソーを抽出し、縦向き回転と等方スケール。元の立体形状を保持して描画座標と開口部キャップを追加。詳細はassets/SOURCE.md。
- Source: https://www.blender.org/download/demo-files/ 。配布ZIP https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip 。公式ページ・collection license・同梱READMEいずれもCC0。許諾 https://creativecommons.org/publicdomain/zero/1.0/ 。
- Pattern: 腕/脚は元モデルの断面周長に沿う近似型紙。内側シームと肘/膝で分割。背中は両肩の後面までを含む幅と高さによる平面投影。各方式の歪みが残るため、紙の仮合わせと50mm校正線を案内する。
- Template reference: https://www.stencilstudio.art/tools/patchwork-tattoo-sleeve-planner の腕SVGで肩→手首のテーパー、中心線、Full sleeve/Upper arm/Forearm区分を参考にした。構図用で実寸型紙ではないためコピーせず、モデル断面の周長から独自計算。
- Transfer sources: https://junotattoodesigns.com/how-to-apply-a-tattoo-stencil/ (腕長による調整)、https://spirittattooproducts.com/pages/create-a-stencil (転写時の紙のずれ)。
- Deferred: サンプル図案集、教材、宣伝文句、医療的な説明は中心フローに不要。
