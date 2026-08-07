import React from 'react'

const PageHeader = ({children}:{children?:string}) => {
  return (
    <h1 className="text-[clamp(32px,6vw,54px)] tracking-[-.02em] text-balans font-heading m-0 mt-3 leading-[0.98]">
      {children}
    </h1>
  );
}

export default PageHeader