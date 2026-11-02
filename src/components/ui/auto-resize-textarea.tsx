"use client";

import {forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes} from "react";

/** A normal textarea that fits its current value, including prefilled answers. */
export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoResizeTextarea({value, defaultValue, onChange, onInput, className, style, ...props}, forwardedRef) {
    const element = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(forwardedRef, () => element.current!, []);
    const resize = useCallback(() => {
      const textarea = element.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      const computed = window.getComputedStyle(textarea);
      const borders = (parseFloat(computed.borderTopWidth) || 0) + (parseFloat(computed.borderBottomWidth) || 0);
      textarea.style.height = `${Math.ceil(textarea.scrollHeight + borders)}px`;
    }, []);

    useLayoutEffect(resize, [resize, value, defaultValue]);
    useLayoutEffect(() => {
      const textarea = element.current;
      if (!textarea) return;
      let width = textarea.clientWidth;
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
        if (textarea.clientWidth !== width) { width = textarea.clientWidth; resize(); }
      });
      observer?.observe(textarea);
      window.addEventListener("resize", resize);
      return () => { observer?.disconnect(); window.removeEventListener("resize", resize); };
    }, [resize]);

    return <textarea {...props} ref={element} value={value} defaultValue={defaultValue}
      className={`block w-full ${className ?? ""}`}
      style={{...style, boxSizing: "border-box", width: "100%", resize: "none", overflow: "hidden"}}
      onChange={event => { resize(); onChange?.(event); }}
      onInput={event => { resize(); onInput?.(event); }} />;
  },
);
