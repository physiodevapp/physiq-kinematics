"use client";

import React, { createContext, useContext } from 'react';

const TensorFlowContext = createContext<boolean>(true);

export const TensorFlowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <TensorFlowContext.Provider value={true}>
    {children}
  </TensorFlowContext.Provider>
);

export const useTensorFlow = (): boolean => useContext(TensorFlowContext);
