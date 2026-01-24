const root = document.getElementById('root');

class UI {
	static LOCALE = 'en-US';
	static currentState = {};
	static qrRead = null;

	static formatCoins(number) {
		number /= UNITS_PER_COIN;
		const formatter = new Intl.NumberFormat(this.LOCALE, {
		    minimumFractionDigits: 2,
		    maximumFractionDigits: 12
		});
		return formatter.format(number)
	}

    static toggleDebugPanel() {
        const panel = document.getElementById('debug-panel');
        if (panel.style.display === 'none') {
            panel.style.display = 'flex';
        } else {
            panel.style.display = 'none';
        }
    }

    static gotoRootView(viewId) {
        Array.from(root.children).forEach(child => {
            child.style.display = 'none';
        });
        root.querySelector('#' + viewId).style.display = 'flex';
	}

	static createTransactionUIElement(transaction, address, unconfirmed=false) {
		let tx = document.createElement('div');
		tx.classList.add('main-transaction');
		const positive = (transaction.to === address);
		tx.classList.add(positive ? 'positive' : 'negative');
		if (unconfirmed) tx.classList.add('blink');
		let amount = document.createElement('div');
		amount.textContent = (positive ? '+' : '-') + this.formatCoins(transaction.amount);
		amount.classList.add('amount');
		tx.appendChild(amount);
		let detail = document.createElement('div');
		detail.textContent = transaction.type === "coinbase" ? "Mining reward" :
			(positive ?
				transaction.from.slice(0, 20) + '...' :
				transaction.to.slice(0, 20)+ '...');
		tx.appendChild(detail);
		return tx;
	}

	static refreshLatestTransactions(blockchain, mempool, address) {
		const latestBlockchainTransactions = blockchain.getLatestTransactions(address);
		const latestMempoolTransactions = mempool.transactions.filter((tx) => (tx.from === address || tx.to === address));

		if (
			this.newState('latestBlockchainTransactions', JSON.stringify(latestBlockchainTransactions)) ||
			this.newState('latestMempoolTransactions', JSON.stringify(latestMempoolTransactions))
			) {
			root.querySelector("#latest-transactions").innerHTML = '';
			for (let transaction of latestMempoolTransactions) {
				root.querySelector("#latest-transactions").appendChild(this.createTransactionUIElement(transaction, address, true));
			}
			for (let transaction of latestBlockchainTransactions) {
				root.querySelector("#latest-transactions").appendChild(this.createTransactionUIElement(transaction, address));
			}
		}
	}

	static newState(fieldName, value) {
		if (
			(this.currentState[fieldName] === undefined) ||
			(this.currentState[fieldName] !== value)
		) {
			this.currentState[fieldName] = value;
			return true;
		}
		return false;
	}

	static refreshQRCode(qrcodeID, content) {
		var qrcode = new QRCode(qrcodeID, {
			text: content,
			width: 200,
			height: 200,
			colorDark : "#ffffff",
			colorLight : "#39393a",
			correctLevel : QRCode.CorrectLevel.H
		});
		qrcode.makeCode(content);
	}

	static readQR() {
		const qr = new Html5Qrcode("reader");

		qr.start(
		  { facingMode: "environment" },
		  { fps: 10, qrbox: 250 },
		  text => {
		    console.log("QR:", text);
		    qr.stop();
		  }
		);
	}

	static prettifyAddress(address) {
		return address.replace(/(.{4})/g, "$1<div class='word-break'></div>");
	}

	static update(address, balance, blockchain, mempool, mining) {
		if (this.newState('address', address)) {
			console.log('updated address.')
			root.querySelector("#main-address").textContent = address;
			UI.refreshQRCode('receive-qrcode', address);
			root.querySelector('#receive-address').innerHTML = this.prettifyAddress(address);
		}
		if (this.newState('balance', balance)) {
			root.querySelector("#main-balance").textContent = this.formatCoins(balance);
		}
		this.refreshLatestTransactions(blockchain, mempool, address);
		if (this.newState('mining', mining)) {
			root.querySelector("#miner-paused").style.display = mining ? 'none': 'flex';
			root.querySelector("#miner-working").style.display = mining ? 'flex': 'none';
		}

    }
}

UI.toggleDebugPanel();
UI.gotoRootView('main');
