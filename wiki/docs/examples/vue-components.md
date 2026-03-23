# Vue Components in Markdown

VitePress supports Vue components directly in Markdown files. This allows you to create interactive documentation.

## Using Vue Components

You can use Vue components directly in your Markdown files:

```vue
<template>
  <div class="custom-component">
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const title = ref('Custom Component')
const description = ref('This is a Vue component used in Markdown')
</script>

<style scoped>
.custom-component {
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}
</style>
```

## Interactive Examples

You can create interactive examples:

```vue
<template>
  <div class="counter-example">
    <p>Count: {{ count }}</p>
    <button @click="increment">Increment</button>
    <button @click="decrement">Decrement</button>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const count = ref(0)

function increment() {
  count.value++
}

function decrement() {
  count.value--
}
</script>
```

## Note on MDX

VitePress does not natively support MDX (Markdown for JSX). Instead, it uses Vue components directly in Markdown files. This provides similar functionality:

- ✅ Vue components in Markdown (native)
- ✅ React components via `@vitejs/plugin-react` (requires wrapper)
- ❌ MDX syntax (not supported)

For React components, you can use the React plugin, but you'll need to wrap them in Vue components or use them via the Vite React plugin.
