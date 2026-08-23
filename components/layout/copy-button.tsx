"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { Copy, CopyCheck } from "lucide-react";

interface CopyButtonProps {
  textToCopy: string;
}

export default function CopyButton({ textToCopy }: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // Use the native Clipboard API
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);

      // Reset the button state after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      className={`text-fg-muted transition-colors size-6 ${
        isCopied && "text-fg-green"
      }`}
    >
      {isCopied ? <CopyCheck /> : <Copy />}
    </Button>
  );
}
