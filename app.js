/* Tabata Coach - Telegram WebApp (frontend only) */
(function(){
	'use strict';

	let tg = null;
	let isTelegram = false;

	const AppState = {
		Initial: 'initial',
		Prepare: 'prepare',
		Work: 'work',
		Rest: 'rest',
		Complete: 'complete'
	};

	const workoutPlan = buildPlan();

	const elements = {
		app: document.getElementById('app'),
		stageText: document.getElementById('stageText'),
		timerText: document.getElementById('timerText'),
		exerciseName: document.getElementById('exerciseName'),
		nextName: document.getElementById('nextName'),
		startBtn: document.getElementById('startBtn'),
		restartBtn: document.getElementById('restartBtn'),
		overallFill: document.getElementById('overallFill'),
		ringProgress: document.querySelector('.ring-progress'),
		controls: document.querySelector('.controls'),
		hint: document.querySelector('.hint'),
	};

	const ringCircumference = 2 * Math.PI * 98; // r=98
	let tickIntervalId = null;
	let tickEndTimestampMs = 0;
	let currentStepIndex = -1;
	let state = AppState.Initial;
	let startedAtEpochMs = 0;
	let totalDurationMs = workoutPlan.reduce((acc, s) => acc + s.durationMs, 0);

	// Audio
	const audio = createAudio();

	setupViewportUnits();
	setupTelegram();
	initUI();
	wireEvents();

	function setupTelegram(){
		try {
			if (window.Telegram && window.Telegram.WebApp) {
				tg = window.Telegram.WebApp;
				isTelegram = true;
				tg.expand();
				tg.ready();
				applyTelegramTheme(tg.themeParams);
				tg.onEvent('themeChanged', () => applyTelegramTheme(tg.themeParams));
				// Use Telegram MainButton instead of in-page controls
				if (elements.controls) elements.controls.classList.add('hidden');
				if (elements.hint) elements.hint.style.display = 'none';
				setupMainButton();
			}
		} catch (e) {}
	}

	function setupViewportUnits(){
		const setVh = () => {
			const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.01;
			document.documentElement.style.setProperty('--vh', `${vh}px`);
		};
		setVh();
		window.addEventListener('resize', setVh);
		window.addEventListener('orientationchange', setVh);
		if (window.visualViewport) window.visualViewport.addEventListener('resize', setVh);
	}

	function applyTelegramTheme(theme){
		try{
			if (!theme) return;
			const root = document.documentElement;
			if (theme.bg_color) {
				root.style.setProperty('--bg', theme.bg_color);
				document.body.style.backgroundColor = theme.bg_color;
			}
			if (theme.text_color) root.style.setProperty('--text', theme.text_color);
			if (theme.hint_color) root.style.setProperty('--muted', theme.hint_color);
		} catch(e){}
	}

	function setupMainButton(){
		if (!isTelegram || !tg) return;
		tg.MainButton.setParams({ text: 'Старт', is_active: true, is_visible: true });
		try { tg.offEvent && tg.offEvent('mainButtonClicked'); } catch(_) {}
		tg.onEvent('mainButtonClicked', () => {
			tg.HapticFeedback && tg.HapticFeedback.impactOccurred('medium');
			if (state === AppState.Complete){
				resetWorkout();
			}
			if (state === AppState.Initial || state === AppState.Complete){
				startWorkout();
			}
		});
	}

	function initUI(){
		updateRing(1);
		updateOverall(0);
		updateTexts('Готовы начать?', 'Нажмите Старт', '');
		setState(AppState.Initial);
	}

	function wireEvents(){
		elements.startBtn.addEventListener('click', () => {
			if (state === AppState.Initial || state === AppState.Complete) {
				startWorkout();
			}
		});
		elements.restartBtn.addEventListener('click', () => {
			resetWorkout();
			startWorkout();
		});
		document.addEventListener('visibilitychange', handleVisibilityChange, false);
		window.addEventListener('beforeunload', () => stopTick());
	}

	function buildPlan(){
		const steps = [];
		const push = (label, type, durationSec, meta={}) => {
			steps.push({ label, type, durationMs: durationSec * 1000, meta });
		};

		// Prepare
		push('Подготовка', 'prepare', 20);

		const blocks = [
			{ name: 'Прыжки', longRestSec: 40 },
			{ name: 'Приседания', longRestSec: 40 },
			{ name: 'Бёрпи', longRestSec: 180 },
		];

		for (let b = 0; b < blocks.length; b++){
			const block = blocks[b];
			for (let i = 1; i <= 4; i++){
				push(block.name, 'work', 20, { set: i, of: 4 });
				if (i < 4) push('Отдых', 'rest', 10, { next: block.name });
			}
			// long rest after 4th; last block -> Шавасана
			const isLastBlock = b === blocks.length - 1;
			if (isLastBlock){
				push('Шавасана', 'rest', block.longRestSec, { next: 'Завершение' });
			}else{
				push('Отдых', 'rest', block.longRestSec, { next: blocks[b+1]?.name });
			}
		}

		// Completion message is not timed; we stop after last rest
		return steps;
	}

	function startWorkout(){
		startedAtEpochMs = Date.now();
		currentStepIndex = -1;
		elements.startBtn.hidden = true;
		elements.restartBtn.hidden = true;
		if (isTelegram && tg){ tg.MainButton.hide(); }
		advanceStep();
	}

	function resetWorkout(){
		stopTick();
		updateRing(1);
		updateOverall(0);
		updateTexts('Готовы начать?', 'Нажмите Старт', '');
		setState(AppState.Initial);
		currentStepIndex = -1;
		if (isTelegram && tg){ tg.MainButton.setText('Старт'); tg.MainButton.show(); }
	}

	function advanceStep(){
		currentStepIndex++;
		if (currentStepIndex >= workoutPlan.length){
			completeWorkout();
			return;
		}
		const step = workoutPlan[currentStepIndex];
		const remainingTotalMs = workoutPlan
			.slice(currentStepIndex)
			.reduce((acc, s) => acc + s.durationMs, 0);
		const elapsedMs = totalDurationMs - remainingTotalMs;
		updateOverall(elapsedMs / totalDurationMs);

		// Update UI texts and state
		if (step.type === 'prepare'){
			updateTexts('Подготовка', 'Подготовка', nextLabelPreview());
			setState(AppState.Prepare);
			audio.beepShort();
		}else if (step.type === 'work'){
			updateTexts(`Упражнение • ${step.label}`, `${step.label} — подход ${step.meta.set}/${step.meta.of}`, upcomingRestPreview());
			setState(AppState.Work);
			audio.beepShort();
		}else if (step.type === 'rest'){
			const isLongRest = step.durationMs > 10*1000;
			updateTexts('Отдых', isLongRest ? `Длинный отдых` : 'Короткий отдых', nextLabelPreview());
			setState(AppState.Rest);
			if (!isLongRest){ audio.tickSoft(); }
		}

		// Start ticking for this step
		startTick(step.durationMs);
	}

	function nextLabelPreview(){
		const next = workoutPlan[currentStepIndex+1];
		if (!next) return '';
		if (next.type === 'work') return `Дальше: ${next.label}`;
		if (next.type === 'rest') return `Дальше: отдых`;
		if (next.type === 'prepare') return `Дальше: подготовка`;
		return '';
	}

	function upcomingRestPreview(){
		const next = workoutPlan[currentStepIndex+1];
		if (!next) return '';
		if (next.type === 'rest'){
			const isLong = next.durationMs > 10*1000;
			return isLong ? 'После: длинный отдых' : 'После: короткий отдых';
		}
		return nextLabelPreview();
	}

	function startTick(durationMs){
		stopTick();
		const startMs = Date.now();
		tickEndTimestampMs = startMs + durationMs;
		updateTimerUI(durationMs);
		const stepType = workoutPlan[currentStepIndex].type;

		tickIntervalId = setInterval(() => {
			const now = Date.now();
			let remaining = Math.max(0, tickEndTimestampMs - now);
			updateTimerUI(remaining);
			if (remaining <= 0){
				stopTick();
				if (stepType === 'work' || stepType === 'prepare' || stepType === 'rest'){
					audio.beepShort();
				}
				advanceStep();
			}
		}, 100);
	}

	function stopTick(){
		if (tickIntervalId){ clearInterval(tickIntervalId); tickIntervalId = null; }
	}

	function updateTimerUI(remainingMs){
		const seconds = Math.ceil(remainingMs / 1000);
		const display = seconds < 60 ? `00:${String(seconds).padStart(2,'0')}` :
			`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
		elements.timerText.textContent = display;
		// blink on last 3 seconds
		if (seconds <= 3 && seconds > 0){
			elements.timerText.classList.add('timer-blink');
		}else{
			elements.timerText.classList.remove('timer-blink');
		}
		// ring progress: 1 -> 0
		const step = workoutPlan[currentStepIndex] || { durationMs: remainingMs };
		const progress = Math.max(0, Math.min(1, 1 - remainingMs / step.durationMs));
		updateRing(1 - progress);
	}

	function updateRing(fracRemaining){
		const offset = ringCircumference * fracRemaining;
		elements.ringProgress.style.strokeDasharray = String(ringCircumference);
		elements.ringProgress.style.strokeDashoffset = String(offset);
	}

	function updateOverall(frac){
		elements.overallFill.style.width = `${Math.floor(frac*100)}%`;
	}

	function updateTexts(stage, current, next){
		animateSwap(elements.stageText, stage);
		animateSwap(elements.exerciseName, current);
		animateSwap(elements.nextName, next);
	}

	function animateSwap(node, newText){
		if (node.textContent === newText) return;
		node.classList.add('fade-enter');
		node.textContent = newText;
		requestAnimationFrame(() => {
			node.classList.add('fade-enter-active');
			setTimeout(() => {
				node.classList.remove('fade-enter');
				node.classList.remove('fade-enter-active');
			}, 340);
		});
	}

	function setState(newState){
		state = newState;
		elements.app.classList.remove('state-initial','state-prepare','state-work','state-rest','state-complete');
		switch(newState){
			case AppState.Initial: elements.app.classList.add('state-initial'); break;
			case AppState.Prepare: elements.app.classList.add('state-prepare'); break;
			case AppState.Work: elements.app.classList.add('state-work'); break;
			case AppState.Rest: elements.app.classList.add('state-rest'); break;
			case AppState.Complete: elements.app.classList.add('state-complete'); break;
		}
	}

	function completeWorkout(){
		stopTick();
		setState(AppState.Complete);
		updateRing(0);
		updateOverall(1);
		updateTexts('Завершение', 'Тренировка завершена. Отличная работа!', 'Нажмите «Заново», чтобы начать снова');
		elements.restartBtn.hidden = false;
		audio.beepLong();
		if (isTelegram && tg){ tg.MainButton.setText('Заново'); tg.MainButton.show(); }
	}

	function handleVisibilityChange(){
		if (document.hidden){ return; }
		if (tickIntervalId){
			const remaining = Math.max(0, tickEndTimestampMs - Date.now());
			updateTimerUI(remaining);
		}
	}

	function createAudio(){
		const ctx = new (window.AudioContext || window.webkitAudioContext)();
		let unlocked = false;
		const unlock = () => { if (!unlocked){ ctx.resume(); unlocked = true; }};

		const beep = (freq=880, durationMs=120, type='sine', volume=0.04) => {
			unlock();
			const now = ctx.currentTime;
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = type; osc.frequency.setValueAtTime(freq, now);
			gain.gain.value = volume;
			osc.connect(gain).connect(ctx.destination);
			osc.start(now);
			osc.stop(now + durationMs/1000);
		};

		const chirp = () => {
			unlock();
			const now = ctx.currentTime;
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'triangle';
			osc.frequency.setValueAtTime(440, now);
			osc.frequency.exponentialRampToValueAtTime(1200, now + 0.12);
			gain.gain.setValueAtTime(0.06, now);
			gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
			osc.connect(gain).connect(ctx.destination);
			osc.start(now);
			osc.stop(now + 0.24);
		};

		return {
			beepShort: () => chirp(),
			beepLong: () => { beep(660, 300, 'sawtooth', 0.05); setTimeout(() => beep(520, 400, 'sawtooth', 0.05), 220); },
			tickSoft: () => { beep(400, 60, 'square', 0.02); },
		};
	}
})();

