import React from "react";

const PageTitle = ({ children }: { children?: string }) => {
  return (
    <h1 className="text-[clamp(32px,6vw,54px)] leading-none tracking-tight text-balans font-serif m-0 mt-3 text-fg //leading-[0.98]">
      {children}
    </h1>
  );
};

export default PageTitle;
