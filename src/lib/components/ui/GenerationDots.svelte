<script lang="ts">
	let { label = 'Generating response' }: { label?: string } = $props();
</script>

<span class="message-dots" role="img" aria-label={label}>
	<span class="message-dot"></span>
	<span class="message-dot" style="animation-delay: 120ms"></span>
	<span class="message-dot" style="animation-delay: 240ms"></span>
</span>

<style>
	.message-dots {
		display: inline-flex;
		align-items: center;
		gap: 0.26rem;
	}

	.message-dot {
		width: 0.36rem;
		height: 0.36rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-accent) 86%, white 14%);
		opacity: 0.92;
		animation: messageDotPulse 900ms ease-in-out infinite;
	}

	@keyframes messageDotPulse {
		0%,
		100% {
			transform: translateY(0) scale(0.95);
			opacity: 0.45;
		}

		50% {
			transform: translateY(-1px) scale(1.08);
			opacity: 1;
		}
	}
</style>
