/*

Copyright (c) 2024, Dominic Szablewski - https://phoboslab.org
SPDX-License-Identifier: MIT

Based on Sonant, published under the Creative Commons Public License
(c) 2008-2009 Jake Taylor [ Ferris / Youth Uprising ] 

*/

let pl_synth_init = (ctx) => {
	let
		samplerate = 44100,

		tab_size = 4096,
		tab_mask = tab_size - 1,
		tab = new Float32Array(tab_size * 4),
		rand_state = 0xd8f554a5,

		generate = (
			row_len, note, buf_l, buf_r, write_pos = 0,
			osc1_oct = 0, osc1_det = 0, osc1_detune = 0, osc1_xenv = 0, osc1_vol = 0, osc1_waveform = 0,
			osc2_oct = 0, osc2_det = 0, osc2_detune = 0, osc2_xenv = 0, osc2_vol = 0, osc2_waveform = 0,
			noise_fader = 0,
			attack = 0, sustain = 0, release = 0, master = 0,
			fx_filter = 0, fx_freq = 0, fx_resonance_p = 0, fx_delay_time = 0, fx_delay_amt = 0, fx_pan_freq_p = 0, fx_pan_amt_p = 0,
			lfo_osc1_freq = 0, lfo_fx_freq = 0, lfo_freq_p = 0, lfo_amt_p = 0, lfo_waveform = 0
		) => {
			let
				uint8_norm = 1 / 255,
				osc_lfo_offset = lfo_waveform * tab_size,
				osc1_offset = osc1_waveform * tab_size,
				osc2_offset = osc2_waveform * tab_size,
				fx_pan_freq = Math.pow(2, fx_pan_freq_p - 8) / row_len,
				fx_pan_amt = fx_pan_amt_p / 512,
				fx_osc_m = 0.5 / samplerate * tab_size,
				lfo_amt = lfo_amt_p / 512,
				lfo_freq = (Math.pow(2, lfo_freq_p - 8) / row_len) * tab_size,

				c1 = 0,
				c2 = 0,

				fx_resonance = fx_resonance_p * uint8_norm,
				noise_vol = noise_fader * 4.6566e-010, /* 1/(2**31) */
				low = 0,
				band = 0,
				high = 0,

				inv_attack = 1 / attack,
				inv_release = 1 / release,

				osc1_freq = Math.pow(1.059463094, (note + (osc1_oct - 8) * 12 + osc1_det) - 128) * 0.00390625 * (1 + 0.0008 * osc1_detune),
				osc2_freq = Math.pow(1.059463094, (note + (osc2_oct - 8) * 12 + osc2_det) - 128) * 0.00390625 * (1 + 0.0008 * osc2_detune),

				num_samples = attack + sustain + release - 1;

			for (let j = num_samples; j >= 0; --j) {
				let
					k = j + write_pos,
					lfor = tab[osc_lfo_offset + ((k * lfo_freq) & tab_mask)] * lfo_amt + 0.5,

					sample = 0,
					filter_f = fx_freq,
					temp_f,
					envelope = 1;

				// Envelope
				if (j < attack) {
					envelope = j * inv_attack;
				}
				else if (j >= attack + sustain) {
					envelope -= (j - attack - sustain) * inv_release;
				}

				// Oscillator 1
				temp_f = osc1_freq;
				if (lfo_osc1_freq) {
					temp_f *= lfor;
				}
				if (osc1_xenv) {
					temp_f *= envelope * envelope;
				}
				c1 += temp_f;
				sample += tab[osc1_offset + ((c1 * tab_size) & tab_mask)] * osc1_vol;

				// Oscillator 2
				temp_f = osc2_freq;
				if (osc2_xenv) {
					temp_f *= envelope * envelope;
				}
				c2 += temp_f;
				sample += tab[osc2_offset + ((c2 * tab_size) & tab_mask)] * osc2_vol;

				// Noise oscillator
				if (noise_fader) {
					rand_state ^= rand_state << 13;
					rand_state ^= rand_state >> 17;
					rand_state ^= rand_state << 5;
					sample += rand_state * noise_vol * envelope;
				}

				sample *= envelope * uint8_norm;

				// State variable filter
				if (fx_filter) {
					if (lfo_fx_freq) {
						filter_f *= lfor;
					}
					filter_f = 1.5 * tab[(filter_f * fx_osc_m) & tab_mask];
					low += filter_f * band;
					high = fx_resonance * (sample - band) - low;
					band += filter_f * high;
					sample = [sample, high, low, band, low + high][fx_filter];
				}

				// Panning & master volume
				temp_f = tab[(k * fx_pan_freq * tab_size) & tab_mask] * fx_pan_amt + 0.5;
				sample *= 0.00238 * master;

				buf_l[k] += sample * (1 - temp_f);
				buf_r[k] += sample * temp_f;
			}
		},

		unundefine = (data) => {
			for (let i = 0; i < data.length; i++) {
				data[i] = Array.isArray(data[i]) ? unundefine(data[i]) : (data[i] ?? 0);
			}
			return data;
		},

		instrumentLen = (instrument, row_len) => {
			let
				delay_shift = (instrument[20/*fx_delay_time*/] * row_len) >> 1,
				delay_amount = instrument[21/*fx_delay_amt*/] / 255,
				delay_iter = Math.ceil(Math.log(0.1) / Math.log(delay_amount));
			return instrument[13/*env_attack*/] +
				instrument[14/*env.sustain*/] +
				instrument[15/*env.release*/] +
				delay_iter * delay_shift;
		},

		apply_delay = (left, right, start, row_len, instrument) => {
			if (!instrument[21/*fx_delay_amt*/]) {
				return;
			}
			let
				delay_shift = (instrument[20/*fx_delay_time*/] * row_len) >> 1,
				delay_amount = instrument[21/*fx_delay_amt*/] / 255,
				len = left.length - delay_shift;
			for (let i = start, j = start + delay_shift; i < len; i++, j++) {
				left[j] += right[i] * delay_amount;
				right[j] += left[i] * delay_amount;
			}
		},

		sound = (instrument, note = 147 /* C-5 */, row_len = 5513 /* 120 BPM */) => {
			instrument = unundefine(instrument);

			let
				num_samples = instrumentLen(instrument, row_len),
				audio_buffer = ctx.createBuffer(2, num_samples, samplerate),
				samples_l = audio_buffer.getChannelData(0),
				samples_r = audio_buffer.getChannelData(1);

			generate(row_len, note, samples_l, samples_r, 0, ...instrument);
			apply_delay(samples_l, samples_r, 0, row_len, instrument);
			return audio_buffer;
		},

		song = (songData) => {
			songData = unundefine(songData);

			let
				row_len = songData[0/*row_len*/],
				tracks = songData[1/*track*/],
				num_samples = 0;
			for (let track of tracks) {
				let track_samples = track[1/*sequence*/].length * row_len * 32 +
					instrumentLen(track[0/*instrument*/], row_len);

				if (track_samples > num_samples) {
					num_samples = track_samples;
				}
			}

			let
				audio_buffer = ctx.createBuffer(2, num_samples, samplerate),
				song_samples_l = audio_buffer.getChannelData(0),
				song_samples_r = audio_buffer.getChannelData(1),
				track_samples_l = new Float32Array(num_samples),
				track_samples_r = new Float32Array(num_samples);

			for (let track of tracks) {
				let
					instrument = track[0/*instrument*/],
					sequence = track[1/*sequence*/],
					write_pos = 0,
					first = num_samples;

				track_samples_l.fill(0);
				track_samples_r.fill(0);

				for (let pi of sequence) {
					for (let row = 0; row < 32; row++) {
						let note = track[2/*patterns*/][pi - 1]?.[row];
						if (note) {
							first = Math.min(first, write_pos);
							generate(row_len, note, track_samples_l, track_samples_r, write_pos, ...instrument);
						}
						write_pos += row_len;
					}
				}

				apply_delay(track_samples_l, track_samples_r, first, row_len, instrument);

				for (let i = first; i < num_samples; i++) {
					song_samples_l[i] += track_samples_l[i];
					song_samples_r[i] += track_samples_r[i];
				}
			}
			return audio_buffer;
		};

	// Generate the lookup tab with 4 oscilators: sin, square, saw, tri
	for (let i = 0; i < tab_size; i++) {
		tab[i] = Math.sin(i * 6.283184 / tab_size);
		tab[i + tab_size] = tab[i] < 0 ? -1 : 1;
		tab[i + tab_size * 2] = i / tab_size - 0.5;
		tab[i + tab_size * 3] = i < tab_size / 2 ? (i / (tab_size / 4)) - 1 : 3 - (i / (tab_size / 4));
	}

	return { sound, song };
};


let tab_size = 4096,
	tab_mask = tab_size - 1,
	tab = new Float32Array(tab_size * 4),
	rand_state = 0xd8f554a5,
	uint8_norm = 1 / 255;

for (let i = 0; i < tab_size; i++) {
	tab[i] = Math.sin(i * 6.283184 / tab_size);
	tab[i + tab_size] = tab[i] < 0 ? -1 : 1;
	tab[i + tab_size * 2] = i / tab_size - 0.5;
	tab[i + tab_size * 3] = i < tab_size / 2 ? (i / (tab_size / 4)) - 1 : 3 - (i / (tab_size / 4));
}

let channel = (rowLen, bufferLen, sampleRate) => {
	let fx_osc_m = 0.5 / sampleRate * tab_size

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
	let time = 0;

	let lfoBuffer = new Float32Array(bufferLen);
	let lfoPhase = 0;

	let low = 0;
	let band = 0;
	let high = 0;

	let delayMask = (1 << 19) - 1;
	let delay = new Float32Array(delayMask + 1);
	let delayCursor = 0;

	// let envelopeBuffer = new Float32Array(bufferLen);

	return [
		(out, samples) => {
			let processed = 0;
			buffer.fill(0);

			while (samples > 0) {
				processing = events.length ? Math.min(samples, events[0][0] - time) : samples;

				if (LFO_WAVEFORM) {
					for (let k = 0; k < processing; ++k) {
						lfoBuffer[i] = LFO_WAVEFORM[lfoPhase] * LFO_AMT + 0.5;
						lfoPhase = (lfoPhase + LFO_FREQ) & tab_mask;
					}
				}

				oscillators = oscillators.filter(oscillator => !oscillator())

				for (let k = 0; k < processing; ++k) {
					let sample = buffer[k];

					// State variable filter
					if (FX_FILTER) {
						let filter_f = LFO_FX_FREQ ? lfoBuffer[k] * FX_FREQ : FX_FREQ;
						filter_f = 1.5 * tab[0][(filter_f * fx_osc_m) & tab_mask];
						low += filter_f * band;
						high = FX_RESONANCE * (sample - band) - low;
						band += filter_f * high;
						sample = [sample, high, low, band, low + high][FX_FILTER];
					}

					sample += delay[(delayCursor - FX_DELAY_TIME) & delayMask] * FX_DELAY_AMT;
					delay[delayCursor] = sample || 0;
					delayCursor = (delayCursor + 1) & delayMask;

					let temp_f = tab[0][(time + k * FX_PAN_FREQ * tab_size) & tab_mask] * FX_PAN_AMT + 0.5;
					sample *= 0.00238 * ENV_MASTER;
	
					out[processed * 2] += sample * (1 - temp_f);
					out[processed * 2 + 1] += sample * temp_f;

					processed++;
				}

				time += processing;
				samples -= processing;

				while (events.length && events[0][0] <= time) {
					events[0][1]();
					events.shift();
				}
			}

			return time;
		},
		(note, t = 0) => scheduleEvent(
			() => {
				let position = 0;

				oscillators.push(() => {
					let osc1_freq = Math.pow(1.059463094, (note + (OSC1_OCT - 8) * 12 + OSC1_DET) - 128) * 0.00390625 * (1 + 0.0008 * OSC1_DETUNE);
					let osc2_freq = Math.pow(1.059463094, (note + (OSC2_OCT - 8) * 12 + OSC2_DET) - 128) * 0.00390625 * (1 + 0.0008 * OSC2_DETUNE);

					for (let i = processed; i < processed + processing; ++i) {
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
						let temp_f = osc1_freq;

						if (LFO_OSC1_FREQ) {
							temp_f *= lfoBuffer[i];
						}

						if (OSC1_XENV) {
							temp_f *= envelope * envelope;
						}

						c1 += temp_f;

						sample += OSC1_WAVEFORM[((c1 * tab_size) & tab_mask)] * OSC1_VOL;

						// Oscillator 2
						temp_f = osc2_freq;

						if (OSC2_XENV) {
							temp_f *= envelope * envelope;
						}

						c2 += temp_f;

						sample += OSC2_WAVEFORM[((c2 * tab_size) & tab_mask)] * OSC2_VOL;

						// Noise oscillator
						if (NOISE_FADER) {
							rand_state ^= rand_state << 13;
							rand_state ^= rand_state >> 17;
							rand_state ^= rand_state << 5;
							sample += rand_state * NOISE_FADER * envelope;
						}

						buffer[i] += sample * envelope * uint8_norm;
					}
				})
			},
			t
		),
		([cmd, v], t = 0) => scheduleEvent(
			() => [
				OSC1_OCT = (v - 8) * 12,
				OSC1_DET = v,
				OSC1_DETUNE = 0.00390625 * (1 + 0.0008 * v),
				OSC1_XENV = v,
				OSC1_VOL = v,
				OSC1_WAVEFORM = tab[v],
				OSC2_OCT = (v - 8) * 12,
				OSC2_DET = v,
				OSC2_DETUNE = 0.00390625 * (1 + 0.0008 * v),
				OSC2_XENV = v,
				OSC2_VOL = v,
				OSC2_WAVEFORM = tab[v],
				NOISE_FADER = v * 4.6566e-010,
				ENV_ATTACK = v,
				ENV_SUSTAIN = v,
				ENV_RELEASE = v,
				ENV_MASTER = v,
				FX_FILTER = v,
				FX_FREQ = v,
				FX_RESONANCE = v * 1 / 255,
				FX_DELAY_TIME = (v * rowLen) >> 1,
				FX_DELAY_AMT = v / 255,
				FX_PAN_FREQ = Math.pow(2, v - 8) / rowLen,
				FX_PAN_AMT = v / 512,
				LFO_OSC1_FREQ = v,
				LFO_FX_FREQ = v,
				LFO_FREQ = (Math.pow(2, v - 8) / rowLen) * tab_size,
				LFO_AMT = v / 512,
				LFO_WAVEFORM = tab[v],
			][cmd](v || 0),
			t
		)
	];
};


