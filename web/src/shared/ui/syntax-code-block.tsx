import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  bundledLanguages,
  bundledLanguagesAlias,
  codeToTokens,
  type BundledLanguage,
} from "shiki";

import { cn } from "@/lib/utils";

type HighlightedLine = Array<{
  content: string;
  color?: string;
  fontStyle?: number;
}>;

function resolveLanguage(language: string | null | undefined): BundledLanguage | null {
  if (!language) {
    return null;
  }

  if (
    Object.prototype.hasOwnProperty.call(bundledLanguages, language) ||
    Object.prototype.hasOwnProperty.call(bundledLanguagesAlias, language)
  ) {
    return language as BundledLanguage;
  }

  return null;
}

function tokenStyle(token: HighlightedLine[number]): CSSProperties | undefined {
  if (!token.color && !token.fontStyle) {
    return undefined;
  }

  return {
    color: token.color,
    fontStyle: token.fontStyle && token.fontStyle & 1 ? "italic" : undefined,
    fontWeight: token.fontStyle && token.fontStyle & 2 ? 600 : undefined,
    textDecoration: token.fontStyle && token.fontStyle & 4 ? "underline" : undefined,
  };
}

export function SyntaxCodeBlock(props: {
  code: string;
  language?: string | null;
  className?: string;
  contentClassName?: string;
  lineClassName?: string;
  lineNumberClassName?: string;
}) {
  const lines = useMemo(() => props.code.split(/\r?\n/), [props.code]);
  const [highlightedLines, setHighlightedLines] = useState<HighlightedLine[] | null>(null);
  const resolvedLanguage = useMemo(() => resolveLanguage(props.language), [props.language]);

  useEffect(() => {
    let cancelled = false;

    if (!resolvedLanguage) {
      setHighlightedLines(null);
      return () => {
        cancelled = true;
      };
    }

    void codeToTokens(props.code, {
      lang: resolvedLanguage,
      theme: "github-dark",
    })
      .then((result) => {
        if (!cancelled) {
          setHighlightedLines(result.tokens as HighlightedLine[]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedLines(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.code, resolvedLanguage]);

  return (
    <div className={cn("min-w-max px-4 py-4 font-mono text-[13px] leading-6", props.className)}>
      {lines.map((line, index) => {
        const tokens = highlightedLines?.[index] ?? null;

        return (
          <div
            key={`${index}-${line}`}
            className={cn("grid grid-cols-[3rem_minmax(0,1fr)] gap-4", props.lineClassName)}
          >
            <span
              className={cn("select-none text-right text-slate-500", props.lineNumberClassName)}
            >
              {index + 1}
            </span>
            <span
              className={cn(
                "whitespace-pre-wrap break-words text-slate-100",
                props.contentClassName,
              )}
            >
              {tokens && tokens.length > 0
                ? tokens.map((token, tokenIndex) => (
                    <span key={`${index}-${tokenIndex}-${token.content}`} style={tokenStyle(token)}>
                      {token.content}
                    </span>
                  ))
                : line || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}
