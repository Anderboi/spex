import React from "react";

const PageContainer = ({ children }: { children: React.ReactNode }) => {
  return (
    <section className="min-h-screen w-full min-w-0 bg-bg text-fg px-4 sm:px-6 md:px-10 pb-35 relative overflow-x-hidden">
      {children}
    </section>
  );
};

export default PageContainer;
