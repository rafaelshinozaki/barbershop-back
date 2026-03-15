// Test script to verify type conversion logic
const testData = [
  {
    email: 'test1@exemplo.com',
    isActive: 'false',
    membership: 'FREE',
  },
  {
    email: 'test2@exemplo.com',
    isActive: 'true',
    membership: 'PAID',
  },
];

console.log('Testing type conversion logic...');

testData.forEach((userData, index) => {
  console.log(`\n--- User ${index + 1} ---`);
  console.log('Original data:', userData);

  // Convert isActive to boolean
  let isActive = false;
  if (userData.isActive !== undefined && userData.isActive !== null) {
    if (typeof userData.isActive === 'string') {
      isActive = userData.isActive.toLowerCase() === 'true' || userData.isActive === '1';
    } else {
      isActive = Boolean(userData.isActive);
    }
  }

  // Validate membership
  let membership = 'FREE';
  if (userData.membership) {
    const membershipUpper = userData.membership.toUpperCase();
    if (['FREE', 'PAID', 'PAST_DUE'].includes(membershipUpper)) {
      membership = membershipUpper;
    } else {
      console.error(`Invalid membership: ${userData.membership}`);
    }
  }

  console.log('Converted data:', {
    isActive: isActive,
    membership: membership,
    isActiveType: typeof isActive,
    membershipType: typeof membership,
  });
});
