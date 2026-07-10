<script setup>
import BrandLogo from './components/BrandLogo.vue'
</script>

<template>
  <v-app>
    <v-app-bar flat density="comfortable" color="background">
      <v-app-bar-title>
        <router-link to="/" class="app-title">
          <BrandLogo :size="34" uid="bar" class="mr-3" />
          <span class="brand-name">Bright Waves</span>
        </router-link>
      </v-app-bar-title>
      <v-btn
        prepend-icon="mdi-projector-screen-outline"
        variant="tonal"
        size="small"
        class="mr-2"
        :to="{ name: 'present' }"
      >
        Display mode
      </v-btn>
      <v-btn
        icon="mdi-github"
        variant="text"
        href="https://github.com/skyfly200/algorithmic-sketchbook"
        target="_blank"
        rel="noopener"
      />
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<style>
.app-title {
  display: inline-flex;
  align-items: center;
  color: inherit;
  text-decoration: none;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.brand-name {
  background: linear-gradient(90deg, #d789d7, #f2ad00 40%, #5bbcd6 80%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 700;
}
</style>
