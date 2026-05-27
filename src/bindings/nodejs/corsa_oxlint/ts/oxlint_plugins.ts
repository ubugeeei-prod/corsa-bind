declare module "@oxlint/plugins" {
  namespace ESTree {
    interface BindingIdentifier {
      typeAnnotation?: TSTypeAnnotation | null;
    }
  }
}

export {};
