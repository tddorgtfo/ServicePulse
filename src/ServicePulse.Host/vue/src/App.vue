<script setup>
import { RouterView } from "vue-router";
import PageFooter from "./components/PageFooter.vue";
import PageHeader from "./components/PageHeader.vue";
import { useServiceControlUrls } from "./composables/serviceServiceControlUrls.js";
import { useServiceControlVersion, useServiceControl } from "./composables/serviceServiceControl.js";
import { useLicense } from "./composables/serviceLicense.js";
import "bootstrap";
import { useAuthentication } from "./composables/authentication.js";

useAuthentication();
useServiceControlUrls();
useServiceControl();
useServiceControlVersion();
useLicense();
</script>

<template>
  <page-header />
  <div class="container-fluid" id="main-content">
    <RouterView />
  </div>
  <page-footer />
</template>
