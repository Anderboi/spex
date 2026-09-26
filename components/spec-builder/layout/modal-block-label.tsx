import React from "react";

const ModalBlockLabel = ({ children }: { children: React.ReactNode }) => {
  return (
    <h4 className="font-mono text-xs text-fg-muted tracking-wider uppercase">{children}</h4>
  );
};

export default ModalBlockLabel;
