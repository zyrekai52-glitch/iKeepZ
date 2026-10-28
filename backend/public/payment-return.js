(function () {
  // The status in the address is only a hint for the wording of this page; it never credits anything.
  var params = new URLSearchParams(window.location.search);
  var status = params.get('status');
  var ref = params.get('ref') || '';
  var title = document.getElementById('title');
  var message = document.getElementById('message');
  if (status === 'success') {
    title.textContent = 'Thanks — one moment';
    message.textContent = 'Go back to the iKeepZ app. We are waiting for the payment provider to confirm your payment, then your balance updates.';
  } else if (status === 'cancelled') {
    title.textContent = 'Checkout closed';
    message.textContent = 'You left the checkout before paying. Go back to the iKeepZ app to try again. If you were charged, your balance still updates once the payment is confirmed.';
  }
  if (/^DEP-[A-Z0-9]{6,24}$/.test(ref)) {
    var chip = document.getElementById('ref');
    chip.textContent = 'Reference ' + ref;
    chip.hidden = false;
  }
})();
