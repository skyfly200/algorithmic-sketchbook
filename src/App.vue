<script setup>
</script>

<template>
  <v-app>
    <v-app-bar flat density="comfortable" color="background">
      <v-app-bar-title>
        <router-link to="/" class="app-title">
          <v-icon icon="mdi-drawing" class="mr-2" color="primary" />
          Algorithmic Sketchbook
        </router-link>
      </v-app-bar-title>
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
  color: inherit;
  text-decoration: none;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
