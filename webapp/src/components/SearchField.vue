<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  label: {
    type: String,
    required: true
  },
  modelValue: {
    type: String,
    required: true
  },
  results: {
    type: Array,
    required: true
  },
  loading: {
    type: Boolean,
    default: false
  },
  selectedLabel: {
    type: String,
    default: ""
  }
});

const emit = defineEmits(["update:modelValue", "select"]);
const open = ref(false);

const showDropdown = computed(() => {
  return open.value && (props.loading || props.results.length > 0 || props.modelValue.trim().length >= 3);
});

function onInput(event) {
  emit("update:modelValue", event.target.value);
}

function onBlur() {
  window.setTimeout(() => {
    open.value = false;
  }, 120);
}

function chooseResult(result) {
  emit("select", result);
  open.value = false;
}
</script>

<template>
  <label class="field">
    <span class="field-label">{{ label }}</span>
    <input
      :value="modelValue"
      class="text-input"
      placeholder="Search for a place"
      @focus="open = true"
      @blur="onBlur"
      @input="onInput"
    />
    <div class="field-note">
      {{ selectedLabel || "Type at least three characters" }}
    </div>
    <div v-if="showDropdown" class="search-results">
      <div v-if="loading" class="search-empty">Searching…</div>
      <template v-else>
        <button
          v-for="result in results"
          :key="result.id"
          class="search-result"
          type="button"
          @mousedown.prevent
          @click="chooseResult(result)"
        >
          {{ result.label }}
        </button>
        <div v-if="!results.length" class="search-empty">No results</div>
      </template>
    </div>
  </label>
</template>
