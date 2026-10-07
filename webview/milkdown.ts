import { Crepe } from '@milkdown/crepe';
import { remarkPluginsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { replaceAll } from '@milkdown/kit/utils';
import { oneDark } from '@codemirror/theme-one-dark';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import './base.css';
import './milkdown.css';
import { bootstrap, isDarkTheme, type EditorAdapter } from './common';

let crepe: Crepe;
/** 外部変更で流し込んだ直後のシリアライズ結果。これと同じ通知は編集として扱わない */
let suppressed: string | undefined;
/**
 * ユーザー操作があったか。Milkdown はノードビューの初期化などで操作なしに
 * ドキュメントを更新することがあり、それを編集扱いにすると開いただけで「変更あり」になる。
 */
let userInteracted = false;
for (const type of ['keydown', 'beforeinput', 'pointerdown', 'paste', 'cut', 'drop']) {
  document.addEventListener(type, () => (userInteracted = true), true);
}

type MdastNode = { type: string; title?: string | null; children?: MdastNode[] };

/**
 * タイトルなしの画像 ![alt](src) は title が null になり、Milkdown の image ノードの
 * スキーマ検証（title は string 必須）で弾かれて画像が消える。パース時に空文字へ補正する。
 */
const remarkImageTitleFix = () => (tree: MdastNode) => {
  const walk = (node: MdastNode) => {
    if (node.type === 'image' && node.title == null) node.title = '';
    node.children?.forEach(walk);
  };
  walk(tree);
};

const adapter: EditorAdapter = {
  async init(root, options, emitEdit) {
    crepe = new Crepe({
      root,
      defaultValue: options.text,
      features: {
        [Crepe.Feature.AI]: false,
        // Crepe の画像ブロックは alt に表示倍率（"1.00" 等）を書き込み、元の alt が失われる。
        // 無効にして標準の画像ノードを使う（alt / title がそのまま保持される）。
        [Crepe.Feature.ImageBlock]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: '入力するか「/」でブロックを挿入', mode: 'block' },
        ...(isDarkTheme() ? { [Crepe.Feature.CodeMirror]: { theme: oneDark } } : {}),
      },
    });
    // 保存時の書式を一般的な Markdown に寄せ、元ファイルとの差分を減らす
    crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (opts) => ({ ...opts, bullet: '-' as const }));
      ctx.update(remarkPluginsCtx, (plugins) => [{ plugin: remarkImageTitleFix, options: {} }, ...plugins]);
    });
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        const isEcho = markdown === suppressed;
        suppressed = undefined;
        if (isEcho || !userInteracted || crepe.readonly) return;
        emitEdit(markdown);
      });
    });
    await crepe.create();
  },

  update(markdown) {
    crepe.editor.action(replaceAll(markdown, true));
    suppressed = crepe.getMarkdown();
  },

  setReadOnly(readOnly) {
    crepe.setReadonly(readOnly);
  },
};

bootstrap(adapter);
