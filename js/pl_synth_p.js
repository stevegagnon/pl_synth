
let createChannel = (bufferLen) => {
	let { sin, min, pow, random } = Math;

	let SIN = v => sin(v * 6.283184);

	let OSC_FUNCTIONS = [
		SIN, // sine
		v => (v % 1) < 0.5 ? 1 : -1, // square
		v => 2 * (v % 1) - 1, // sawtooth
		v => { const v2 = (v % 1) * 4; return v2 < 2 ? v2 - 1 : 3 - v2 }, // triangle
	];

	let events = [];
	let oscillators = [];

	let OSC1_OCT = 0;
	let OSC1_DET = 0;
	let OSC1_DETUNE = 0;
	let OSC1_XENV = 0;
	let OSC1_VOL = 0;
	let OSC1_WAVEFORM = 0;
	let OSC2_OCT = 0;
	let OSC2_DET = 0;
	let OSC2_DETUNE = 0;
	let OSC2_XENV = 0;
	let OSC2_VOL = 0;
	let OSC2_WAVEFORM = 0;
	let NOISE_FADER = 0;
	let ENV_ATTACK = 0;
	let ENV_SUSTAIN = 0;
	let ENV_RELEASE = 0;
	let ENV_MASTER = 0;
	let FX_FILTER = 0;
	let FX_FREQ = 0;
	let FX_RESONANCE = 0;
	let FX_DELAY_TIME = 0;
	let FX_DELAY_AMT = 0;
	let FX_PAN_FREQ = 0;
	let FX_PAN_AMT = 0;
	let LFO_OSC1_FREQ = 0;
	let LFO_FX_FREQ = 0;
	let LFO_FREQ = 0;
	let LFO_AMT = 0;
	let LFO_WAVEFORM = 0;

	let scheduleEvent = (e, t) => {
		events.push([t, e]);
		events.sort(([t0], [t1]) => t0 - t1);
		return e;
	};

	let buffer = new Float32Array(bufferLen);
	let processing = 0;
	let processed = 0;
	let time = 0;

	let low = 0;
	let band = 0;
	let high = 0;

	let delayMask = (1 << 19) - 1;
	let delay = new Float32Array(delayMask + 1);
	let delayCursor = 0;

	// let envelopeBuffer = new Float32Array(bufferLen);

	delay.fill(0);

	return [
		(out1, out2, samples) => {
			processed = 0;

			while (samples > 0) {
				while (events.length && events[0][0] <= time) {
					events[0][1]();
					events.shift();
				}

				processing = min(bufferLen, events.length ? min(samples, events[0][0] - time) : samples);

				buffer.fill(0);

				oscillators = oscillators.filter(oscillator => !oscillator())

				for (let k = 0; k < processing; ++k) {
					let sample = buffer[k];

					// State variable filter
					if (FX_FILTER) {
						let filter_f = LFO_FX_FREQ ? (LFO_WAVEFORM((time + k) * LFO_FREQ) * LFO_AMT + 0.5) * FX_FREQ : FX_FREQ;
						filter_f = 1.5 * SIN(filter_f);
						low += filter_f * band;
						high = FX_RESONANCE * (sample - band) - low;
						band += filter_f * high;
						sample = [sample, high, low, band, low + high][FX_FILTER];
					}

					sample += delay[(delayCursor - FX_DELAY_TIME) & delayMask] * FX_DELAY_AMT;
					delay[delayCursor] = sample || 0;
					delayCursor = (delayCursor + 1) & delayMask;

					let temp_f = SIN((time + k) * FX_PAN_FREQ) * FX_PAN_AMT + 0.5;

					sample *= ENV_MASTER;

					out1[processed] += sample * (1 - temp_f);
					out2[processed] += sample * temp_f;

					processed++;
				}

				time += processing;
				samples -= processing;
			}

			return [time, oscillators];
		},
		(note, t = 0) => scheduleEvent(
			() => {
				let position = 0;
				let c1 = 0;
				let c2 = 0

				oscillators.push(() => {

					let osc1_freq = pow(1.059463094, (note + OSC1_OCT + OSC1_DET) - 128) * OSC1_DETUNE;
					let osc2_freq = pow(1.059463094, (note + OSC2_OCT + OSC2_DET) - 128) * OSC2_DETUNE;

					for (let i = 0; i < processing; ++i) {
						if (position >= ENV_ATTACK + ENV_SUSTAIN + ENV_RELEASE) {
							return true;
						}

						let releaseInv = ENV_RELEASE === 0 ? 0 : 1 / ENV_RELEASE;
						let envelope = position < ENV_ATTACK ? position / ENV_ATTACK
							: position >= ENV_ATTACK + ENV_SUSTAIN ? 1 - (position - ENV_ATTACK - ENV_SUSTAIN) * releaseInv
								: 1;

						let sample = 0;

						position++;

						// Oscillator 1
						c1 += (LFO_OSC1_FREQ ? osc1_freq * (LFO_WAVEFORM((time + i) * LFO_FREQ) * LFO_AMT + 0.5) : osc1_freq) * (OSC1_XENV ? envelope * envelope : 1);

						sample += OSC1_WAVEFORM(c1) * OSC1_VOL;

						// Oscillator 2
						c2 += OSC2_XENV ? osc2_freq * envelope * envelope : osc2_freq;

						sample += OSC2_WAVEFORM(c2) * OSC2_VOL;

						// Noise oscillator
						if (NOISE_FADER) {
							sample += (random() * 2 - 1) * NOISE_FADER * envelope;
						}

						buffer[i] += sample * envelope * (1 / 255);
					}
				})
			},
			t
		),
		([cmd, v, rowLen], t = 0) => scheduleEvent(
			() => ([
				v => OSC1_OCT = (v - 8) * 12,
				v => OSC1_DET = v,
				v => OSC1_DETUNE = 0.00390625 * (1 + 0.0008 * v),
				v => OSC1_XENV = v,
				v => OSC1_VOL = v,
				v => OSC1_WAVEFORM = OSC_FUNCTIONS[v],
				v => OSC2_OCT = (v - 8) * 12,
				v => OSC2_DET = v,
				v => OSC2_DETUNE = 0.00390625 * (1 + 0.0008 * v),
				v => OSC2_XENV = v,
				v => OSC2_VOL = v,
				v => OSC2_WAVEFORM = OSC_FUNCTIONS[v],
				v => NOISE_FADER = v,
				v => ENV_ATTACK = v,
				v => ENV_SUSTAIN = v,
				v => ENV_RELEASE = v,
				v => ENV_MASTER = 0.00238 * v,
				v => FX_FILTER = v,
				v => FX_FREQ = 0.5 / 44100 * v,
				v => FX_RESONANCE = v * 1 / 255,
				v => FX_DELAY_TIME = (v * rowLen) >> 1,
				v => FX_DELAY_AMT = v / 255,
				v => FX_PAN_FREQ = pow(2, v - 8) / rowLen,
				v => FX_PAN_AMT = v / 512,
				v => LFO_OSC1_FREQ = v,
				v => LFO_FX_FREQ = v,
				v => LFO_FREQ = pow(2, v - 8) / rowLen,
				v => LFO_AMT = v / 512,
				v => LFO_WAVEFORM = OSC_FUNCTIONS[v],
			][cmd]?.(v || 0) ?? {
				c: () => oscillators = [],
			}[cmd]?.(v || 0)),
			t
		)
	];
};

// let instrumentLen = (instrument, row_len) => {
// 	let
// 		delay_shift = (instrument[20/*fx_delay_time*/] * row_len) >> 1,
// 		delay_amount = instrument[21/*fx_delay_amt*/] / 255,
// 		delay_iter = Math.ceil(Math.log(0.1) / Math.log(delay_amount));
// 	return instrument[13/*env_attack*/] +
// 		instrument[14/*env.sustain*/] +
// 		instrument[15/*env.release*/] +
// 		delay_iter * delay_shift;
// };


// let pl_synth_init = (ctx) => {
// 	let samplerate = 44100;

// 	let sound = (instrument, note = 147 /* C-5 */, row_len = 5513 /* 120 BPM */) => {

// 		let
// 			num_samples = instrumentLen(instrument, row_len),
// 			audio_buffer = ctx.createBuffer(2, num_samples, samplerate),
// 			samples_l = audio_buffer.getChannelData(0),
// 			samples_r = audio_buffer.getChannelData(1);


// 		const [render, playNote, cmd] = createChannel(row_len, num_samples, samplerate);

// 		instrument.map((v, i) => cmd([i, v]));

// 		playNote(note);

// 		render(samples_l, samples_r, num_samples);

// 		return audio_buffer;
// 	};

// 	let song = (songData) => {
// 		let
// 			row_len = songData[0/*row_len*/],
// 			tracks = songData[1/*track*/],
// 			num_samples = 0;

// 		for (let track of tracks) {
// 			let track_samples = track[1/*sequence*/].length * row_len * 32 +
// 				instrumentLen(track[0/*instrument*/], row_len);

// 			if (track_samples > num_samples) {
// 				num_samples = track_samples;
// 			}
// 		}

// 		let
// 			audio_buffer = ctx.createBuffer(2, num_samples, samplerate),
// 			song_samples_l = audio_buffer.getChannelData(0),
// 			song_samples_r = audio_buffer.getChannelData(1);

// 		for (let track of tracks) {
// 			let
// 				instrument = track[0/*instrument*/],
// 				sequence = track[1/*sequence*/],
// 				write_pos = 0;

// 			const [render, playNote, cmd] = createChannel(row_len, 100_000, samplerate);

// 			instrument.map((v, i) => cmd([i, v]));

// 			for (let pi of sequence) {
// 				for (let row = 0; row < 32; row++) {
// 					let note = track[2/*patterns*/][pi - 1]?.[row];
// 					if (note) {
// 						playNote(note, write_pos)
// 					}
// 					write_pos += row_len;
// 				}
// 			}

// 			render(song_samples_l, song_samples_r, num_samples);
// 		}
// 		return audio_buffer;
// 	};

// 	return { sound, song };
// };
