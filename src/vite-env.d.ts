/// <reference types="vite/client" />

/**
 * このページを組み立てた日時。ビルドのときに埋め込まれる（vite.config.ts）。
 * 同じ文字列が `version.txt` としても置かれるので、
 * 突き合わせれば「開いているページが古いままか」が分かる。
 */
declare const __BUILD_ID__: string
